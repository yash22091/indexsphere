import { afterEach, describe, expect, it } from 'vitest';
import { assertSafeOutboundUrl, blockedAddressReason, parseOutboundUrl, UnsafeUrlError } from '@/lib/url-guard';

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });

describe('blockedAddressReason', () => {
  it('blocks metadata, link-local, multicast and unspecified addresses', () => {
    for (const ip of ['169.254.169.254', '169.254.0.1', '100.100.100.200', '0.0.0.0', '224.0.0.1',
      'fe80::1', 'fd00:ec2::254', '::', '::ffff:169.254.169.254', '[fd00:ec2::254]']) {
      expect(blockedAddressReason(ip), ip).not.toBeNull();
    }
  });

  it('allows private on-prem ranges and public addresses', () => {
    for (const ip of ['10.0.0.5', '172.20.10.4', '192.168.1.10', '8.8.8.8', '2001:db8::1']) {
      expect(blockedAddressReason(ip), ip).toBeNull();
    }
  });

  it('blocks loopback in production unless explicitly allowed', () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    delete process.env.ALLOW_LOOPBACK_TARGETS;
    expect(blockedAddressReason('127.0.0.1')).not.toBeNull();
    expect(blockedAddressReason('::1')).not.toBeNull();
    process.env.ALLOW_LOOPBACK_TARGETS = 'true';
    expect(blockedAddressReason('127.0.0.1')).toBeNull();
  });
});

describe('parseOutboundUrl', () => {
  it('rejects non-http schemes, embedded credentials and metadata hosts', () => {
    expect(() => parseOutboundUrl('file:///etc/passwd')).toThrow(UnsafeUrlError);
    expect(() => parseOutboundUrl('gopher://x')).toThrow(UnsafeUrlError);
    expect(() => parseOutboundUrl('http://u:p@es.local:9200')).toThrow(UnsafeUrlError);
    expect(() => parseOutboundUrl('http://169.254.169.254/latest/meta-data')).toThrow(UnsafeUrlError);
    expect(() => parseOutboundUrl('http://[fd00:ec2::254]/')).toThrow(UnsafeUrlError);
  });

  it('enforces CLUSTER_HOST_ALLOWLIST for cluster URLs only', () => {
    process.env.CLUSTER_HOST_ALLOWLIST = 'es1.corp,*.search.internal';
    expect(() => parseOutboundUrl('https://es1.corp:9200', 'cluster')).not.toThrow();
    expect(() => parseOutboundUrl('https://a.search.internal:9200', 'cluster')).not.toThrow();
    expect(() => parseOutboundUrl('https://evil.example:9200', 'cluster')).toThrow(UnsafeUrlError);
    expect(() => parseOutboundUrl('https://evil.example', 'external')).not.toThrow();
  });
});

describe('assertSafeOutboundUrl', () => {
  it('rejects hostnames that resolve to blocked addresses', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    delete process.env.ALLOW_LOOPBACK_TARGETS;
    await expect(assertSafeOutboundUrl('http://localhost:9200')).rejects.toThrow(UnsafeUrlError);
  });
});
