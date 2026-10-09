/**
 * Whether the session cookie gets the Secure flag. Defaults to on in production.
 * Browsers drop Secure cookies on plain-HTTP origins (other than localhost), so
 * internal HTTP-only deployments must set COOKIE_SECURE=false — prefer HTTPS.
 */
export function secureCookies(): boolean {
  if (process.env.COOKIE_SECURE === 'true') return true;
  if (process.env.COOKIE_SECURE === 'false') return false;
  return process.env.NODE_ENV === 'production';
}
