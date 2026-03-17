import { randomBytes } from 'crypto';

/**
 * A random nonce generated once per server process start, stored on globalThis
 * so it is shared across all Next.js route bundles in the same Node.js process.
 *
 * Each route is compiled into an isolated webpack bundle with its own module
 * registry, so a plain module-level variable would produce different values per
 * bundle.  globalThis (=== Node.js `global`) is the single object shared by the
 * entire process, solving that problem.
 *
 * Every JWT issued during this boot carries `bid: BOOT_NONCE`.  On every
 * /api/auth/verify call the bid claim is compared against the current nonce.
 * When the container (process) restarts the nonce changes, so all tokens from
 * previous boots are automatically rejected and browser sessions are cleared.
 */
const KEY = '__INDEXSPHERE_BOOT_NONCE__';
if (!(globalThis as any)[KEY]) {
  (globalThis as any)[KEY] = randomBytes(16).toString('hex');
}

export const BOOT_NONCE: string = (globalThis as any)[KEY];
