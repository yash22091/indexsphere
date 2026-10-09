/**
 * Outbound URL guard — SSRF protection for every server-side request whose
 * destination is influenced by a user (cluster URLs, AI provider URLs, webhooks).
 *
 * On-prem clusters live on private networks, so RFC1918 ranges are allowed.
 * What is always blocked is the stuff an attacker actually wants to reach:
 * cloud metadata services (169.254.169.254, fd00:ec2::254, 100.100.100.200),
 * link-local, multicast and the unspecified address. Loopback is blocked in
 * production unless ALLOW_LOOPBACK_TARGETS=true.
 *
 * Optional: CLUSTER_HOST_ALLOWLIST="es1.corp,10.0.0.5,*.search.internal"
 * restricts cluster connections to the listed hosts.
 */
import dns from 'dns';
import net from 'net';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

function loopbackAllowed(): boolean {
  if (process.env.ALLOW_LOOPBACK_TARGETS === 'true') return true;
  if (process.env.ALLOW_LOOPBACK_TARGETS === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function inCidr4(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/** Returns a reason string when the address must not be contacted, otherwise null. */
export function blockedAddressReason(address: string): string | null {
  let ip = address.toLowerCase();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);

  // IPv4-mapped IPv6 (::ffff:169.254.169.254) — evaluate the embedded IPv4
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) ip = mapped[1];

  if (net.isIPv4(ip)) {
    if (inCidr4(ip, '0.0.0.0', 8)) return 'unspecified address';
    if (inCidr4(ip, '169.254.0.0', 16)) return 'link-local / cloud metadata address';
    if (ip === '100.100.100.200') return 'cloud metadata address';
    if (inCidr4(ip, '224.0.0.0', 4) || ip === '255.255.255.255') return 'multicast/broadcast address';
    if (inCidr4(ip, '127.0.0.0', 8) && !loopbackAllowed()) return 'loopback address';
    return null;
  }

  if (net.isIPv6(ip)) {
    if (ip === '::') return 'unspecified address';
    if (ip === '::1') return loopbackAllowed() ? null : 'loopback address';
    if (/^fe[89ab][0-9a-f]:/.test(ip)) return 'link-local address';
    if (ip.startsWith('ff')) return 'multicast address';
    if (ip === 'fd00:ec2::254') return 'cloud metadata address';
    return null;
  }

  return null;
}

function hostMatchesAllowlist(hostname: string): boolean {
  const raw = process.env.CLUSTER_HOST_ALLOWLIST?.trim();
  if (!raw) return true;
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).some(entry => {
    if (entry.startsWith('*.')) return host.endsWith(entry.slice(1));
    return host === entry;
  });
}

/** Parse and validate the shape of an outbound http(s) URL (no network access). */
export function parseOutboundUrl(raw: unknown, purpose: 'cluster' | 'external' = 'external'): URL {
  if (typeof raw !== 'string' || !raw.trim()) throw new UnsafeUrlError('URL is required');
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('URL must start with http:// or https://');
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('Credentials must not be embedded in the URL');
  }
  if (purpose === 'cluster' && !hostMatchesAllowlist(url.hostname)) {
    throw new UnsafeUrlError(`Host "${url.hostname}" is not in CLUSTER_HOST_ALLOWLIST`);
  }
  const literalReason = blockedAddressReason(url.hostname);
  if (literalReason) throw new UnsafeUrlError(`Destination not allowed (${literalReason})`);
  return url;
}

/**
 * Full check: shape + DNS resolution of the hostname. Use before any outbound
 * call made with global fetch (AI providers, webhooks).
 */
export async function assertSafeOutboundUrl(raw: unknown, purpose: 'cluster' | 'external' = 'external'): Promise<URL> {
  const url = parseOutboundUrl(raw, purpose);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return url;

  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new UnsafeUrlError(`Cannot resolve host "${host}"`);
  }
  for (const { address } of addresses) {
    const reason = blockedAddressReason(address);
    if (reason) throw new UnsafeUrlError(`Destination not allowed (${host} resolves to ${reason})`);
  }
  return url;
}

/**
 * dns.lookup replacement for http(s).request — validates the address that is
 * actually connected to, which defeats DNS-rebinding between check and use.
 */
export function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    for (const { address } of addresses) {
      const reason = blockedAddressReason(address);
      if (reason) {
        return callback(new UnsafeUrlError(`Destination not allowed (${hostname} resolves to ${reason})`), '', 0);
      }
    }
    if (options.all) return callback(null, addresses);
    const first = addresses[0];
    callback(null, first.address, first.family);
  });
}
