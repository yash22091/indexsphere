/**
 * Client-side PII sanitizer.
 * Redacts sensitive fields BEFORE any text is sent to an external AI provider.
 * Nothing about cluster credentials, user data, or operational secrets should
 * leave the app to a third-party AI service.
 */

export interface RedactionEntry { type: string; count: number }
export interface SanitizeResult { sanitized: string; redactions: RedactionEntry[] }

const PATTERNS: Array<{ name: string; regex: RegExp; replacement: string }> = [
  // JWT / Bearer tokens
  { name: 'JWT Token',      regex: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, replacement: '[JWT]' },
  // Common API key prefixes (OpenAI, Anthropic, Stripe, …)
  { name: 'API Key',        regex: /\b(sk-ant-api[\w-]{30,}|sk-proj-[\w-]{30,}|sk-[\w-]{20,}|pk_live_\w{10,}|pk_test_\w{10,}|Bearer\s+[A-Za-z0-9_.~+/-]{20,})/g, replacement: '[API_KEY]' },
  // AWS key IDs
  { name: 'AWS Key',        regex: /\b(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g, replacement: '[AWS_KEY]' },
  // SSH / PGP private keys
  { name: 'Private Key',    regex: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, replacement: '[PRIVATE_KEY]' },
  // Email addresses
  { name: 'Email',          regex: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, replacement: '[EMAIL]' },
  // IPv4
  { name: 'IPv4',           regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[IP]' },
  // IPv6
  { name: 'IPv6',           regex: /\b([0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{0,4}\b/g, replacement: '[IPv6]' },
  // Phone numbers (international + US formats)
  { name: 'Phone',          regex: /(\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, replacement: '[PHONE]' },
  // Credit card numbers (loose: 4×4 digits with optional separators)
  { name: 'Credit Card',    regex: /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g, replacement: '[CARD]' },
  // SHA-1 / SHA-256 hashes (standalone hex strings)
  { name: 'Hex Hash',       regex: /\b[0-9a-fA-F]{40}\b|\b[0-9a-fA-F]{64}\b/g, replacement: '[HASH]' },
  // UUIDs
  { name: 'UUID',           regex: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/gi, replacement: '[UUID]' },
  // JSON fields with sensitive names: "password":"...", "secret":"...", etc.
  {
    name: 'Secret Field',
    regex: /("(?:password|passwd|secret|credential|token|apikey|api_key|private_key|access_token|refresh_token|auth_token|authorization|bearer|ssn|dob|date_of_birth)")\s*:\s*("[^"]{1,500}")/gi,
    replacement: '$1:"[REDACTED]"',
  },
  // URL-embedded passwords: https://user:pass@host
  { name: 'URL Password',   regex: /(:\/\/[^:@\s]+:)[^@\s]+(@)/g, replacement: '$1[REDACTED]$2' },
];

/** Sanitize text, returning the cleaned string and a summary of what was redacted. */
export function sanitize(text: string): SanitizeResult {
  let out = text;
  const counts: Record<string, number> = {};

  for (const { name, regex, replacement } of PATTERNS) {
    const hits = out.match(regex);
    if (hits) {
      counts[name] = (counts[name] ?? 0) + hits.length;
      out = out.replace(regex, replacement);
    }
  }

  return {
    sanitized: out,
    redactions: Object.entries(counts).map(([type, count]) => ({ type, count })),
  };
}

/** Returns true if any PII is detected without modifying the text. */
export function hasPII(text: string): boolean {
  return PATTERNS.some(({ regex }) => { regex.lastIndex = 0; return regex.test(text); });
}
