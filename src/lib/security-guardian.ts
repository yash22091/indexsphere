/**
 * Client-side Security Guardian
 *
 * When Traffic Security Lock is ENABLED (stored in DB, toggled via Settings):
 *   • DevTools detection — if DevTools is open a lockout overlay is shown
 *   • F12 / Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+U keyboard shortcuts are blocked
 *   • Right-click context menu is disabled
 *   • Every sensitive API request is HMAC-signed so the server can detect
 *     if the payload was modified in transit (e.g. by Burp Suite)
 *
 * When DEBUG MODE is active (requires the backend debug password):
 *   • All of the above protections are bypassed for this browser session
 *   • A prominent warning banner is shown so nobody forgets they're in debug mode
 *   • Every action during debug mode is flagged in the audit log
 *
 * What this protects against (honestly):
 *   ✔ Casual browser DevTools inspection
 *   ✔ F12 / right-click shortcuts
 *   ✔ Modification of requests in flight (HMAC tamper-detection)
 *   ✔ Replay of stale signed requests (60-second timestamp window)
 *
 * What it does NOT protect against:
 *   ✘ An attacker who has installed a trusted proxy CA cert (e.g. Burp CA)
 *     — that is a host-level trust decision, not something a web app can stop.
 *   ✘ Passive traffic observation if TLS is not used
 *     — always run IndexSphere over HTTPS in production.
 */

const SIGNING_KEY_SS  = 'is:sigK';   // sessionStorage key for the HMAC signing key
const DEBUG_ACTIVE_SS = 'is:debug';  // sessionStorage key for debug-mode token
const LOCK_STATE_LS   = 'is:secLock'; // localStorage key — shared across components

// ──────────────────────────────────────────────────────
// Lock-state localStorage helpers
// (SecurityGuard and Settings page both read/write this
//  so the guard reacts immediately without a page reload)
// ──────────────────────────────────────────────────────

export function writeLockState(enabled: boolean): void {
  if (typeof window !== 'undefined') localStorage.setItem(LOCK_STATE_LS, enabled ? '1' : '0');
}

export function readLockState(): boolean | null {
  if (typeof window === 'undefined') return null;
  const v = localStorage.getItem(LOCK_STATE_LS);
  if (v === null) return null;
  return v === '1';
}

// ──────────────────────────────────────────────────────
// Signing-key helpers (set once at login by auth context)
// ──────────────────────────────────────────────────────

export function storeSigningKey(key: string): void {
  if (typeof window !== 'undefined') sessionStorage.setItem(SIGNING_KEY_SS, key);
}

export function getSigningKey(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(SIGNING_KEY_SS);
}

export function clearSigningKey(): void {
  if (typeof window !== 'undefined') sessionStorage.removeItem(SIGNING_KEY_SS);
}

// ──────────────────────────────────────────────────────
// Debug-mode helpers
// ──────────────────────────────────────────────────────

export function isDebugMode(): boolean {
  if (typeof window === 'undefined') return false;
  const token = sessionStorage.getItem(DEBUG_ACTIVE_SS);
  if (!token) return false;
  try {
    const { exp } = JSON.parse(atob(token.split('.')[1] ?? '{}'));
    if (exp && Date.now() / 1000 > exp) { sessionStorage.removeItem(DEBUG_ACTIVE_SS); return false; }
    return true;
  } catch { return false; }
}

export function setDebugToken(jwtToken: string): void {
  if (typeof window !== 'undefined') sessionStorage.setItem(DEBUG_ACTIVE_SS, jwtToken);
}

export function clearDebugMode(): void {
  if (typeof window !== 'undefined') sessionStorage.removeItem(DEBUG_ACTIVE_SS);
}

// ──────────────────────────────────────────────────────
// HMAC request signing
// Signs: HMAC-SHA256( "<timestamp>:<METHOD>:<pathname>:<bodyHex>", signingKey )
// Server validates via /api/settings/security validation helper.
// ──────────────────────────────────────────────────────

async function sha256hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256hex(message: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A fetch wrapper that, when the security lock is enabled and debug mode is off,
 * adds tamper-detection HMAC headers to every request.
 * Drop-in replacement for fetch() in page components.
 */
export async function secureFetch(
  url: string,
  options: RequestInit = {},
  lockEnabled = false
): Promise<Response> {
  const sigKey = getSigningKey();
  if (!lockEnabled || isDebugMode() || !sigKey) {
    return fetch(url, options);
  }

  const ts = Date.now().toString();
  const method = (options.method ?? 'GET').toUpperCase();
  const pathname = typeof url === 'string' ? new URL(url, window.location.origin).pathname : '/';
  const rawBody = typeof options.body === 'string' ? options.body : '';
  const bodyHash = await sha256hex(rawBody);
  const payload = `${ts}:${method}:${pathname}:${bodyHash}`;
  const sig = await hmacSha256hex(payload, sigKey);

  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers as Record<string, string> ?? {}),
      'X-Req-Ts': ts,
      'X-Req-Sig': sig,
    },
  });
}

// ──────────────────────────────────────────────────────
// DevTools detection — four complementary techniques
//   1. Size heuristic: undocked / bottom-docked DevTools
//   2. Baseline calibration: compare current diff to
//      a stored "clean" diff measured right after page load
//   3. debugger timing: DevTools dramatically slows the
//      empty statement between two performance.now() calls
//   4. Console object-getter: DevTools calls toString() /
//      Symbol.toPrimitive when it formats console output
// ──────────────────────────────────────────────────────

// Baseline size diff measured at mount (before DevTools opens).
let _baselineH = -1;
let _baselineW = -1;

export function calibrateDevToolsBaseline(): void {
  if (typeof window === 'undefined') return;
  _baselineH = window.outerHeight - window.innerHeight;
  _baselineW = window.outerWidth - window.innerWidth;
}

// Getter-trick detector — mutated by the console-probe in startConsoleProbe()
let _consoleProbeResult = false;

export function isDevToolsOpen(): boolean {
  if (typeof window === 'undefined') return false;

  // 1. Size heuristic -------------------------------------------------------
  const hDiff = window.outerHeight - window.innerHeight;
  const wDiff = window.outerWidth  - window.innerWidth;
  // DevTools docked at bottom: innerHeight shrinks → hDiff grows by 200-400 px
  // DevTools docked on side  : innerWidth  shrinks → wDiff grows by 200-400 px
  // Undocked / detached      : outerWidth/Height grows vs inner
  const baseH = _baselineH >= 0 ? _baselineH : 90;  // 90 = typical browser chrome
  const baseW = _baselineW >= 0 ? _baselineW : 0;
  if ((hDiff - baseH) > 160 || (wDiff - baseW) > 160) return true;

  // 2. debugger timing ------------------------------------------------------
  // When DevTools is open the engine pauses for the debugger; this adds ≥1 ms.
  // We use a very tight loop so it's imperceptible when DevTools is closed.
  const t0 = performance.now();
  // eslint-disable-next-line no-debugger
  debugger;
  if (performance.now() - t0 > 80) return true;

  // 3. Console object-getter probe ------------------------------------------
  if (_consoleProbeResult) return true;

  return false;
}

/**
 * Starts a periodic console probe that detects open DevTools via the
 * toString/toPrimitive getter trick.  Call once when lock is attached.
 * The probe clears its own console output to avoid cluttering the log.
 */
let _consoleProbeId: ReturnType<typeof setInterval> | null = null;

export function startConsoleProbe(): void {
  if (typeof window === 'undefined') return;
  if (_consoleProbeId !== null) return; // already running
  _consoleProbeId = setInterval(() => {
    _consoleProbeResult = false;
    const probe = Object.create(null) as Record<string | symbol, unknown>;
    const detect = () => { _consoleProbeResult = true; return ''; };
    Object.defineProperty(probe, 'toString',       { get: detect, configurable: true });
    Object.defineProperty(probe, Symbol.toPrimitive, { get: detect, configurable: true });
    // DevTools formats probe when logging → triggers the getter
    console.log('%c', probe as unknown as string);
    console.clear();
  }, 1500);
}

export function stopConsoleProbe(): void {
  if (_consoleProbeId !== null) { clearInterval(_consoleProbeId); _consoleProbeId = null; }
  _consoleProbeResult = false;
}

// ──────────────────────────────────────────────────────
// Console suppression (when lock is active)
// Nullifying console methods makes the DevTools Console
// useless even if the user manages to open it.
// ──────────────────────────────────────────────────────

const CONSOLE_METHODS = [
  'log','warn','info','debug','error','table','dir','dirxml',
  'group','groupCollapsed','groupEnd','time','timeEnd','timeLog',
  'count','countReset','trace','assert','profile','profileEnd',
] as const;

let _savedConsoleMethods: Partial<Record<string, typeof console.log>> = {};

export function suppressConsole(): void {
  if (typeof window === 'undefined') return;
  const noop = () => undefined;
  CONSOLE_METHODS.forEach(fn => {
    _savedConsoleMethods[fn] = (console as unknown as Record<string, typeof console.log>)[fn];
    (console as unknown as Record<string, typeof console.log>)[fn] = noop;
  });
}

export function restoreConsole(): void {
  if (typeof window === 'undefined') return;
  CONSOLE_METHODS.forEach(fn => {
    const orig = _savedConsoleMethods[fn];
    if (orig) (console as unknown as Record<string, typeof console.log>)[fn] = orig;
  });
  _savedConsoleMethods = {};
}

// ──────────────────────────────────────────────────────
// DOM-level protections (attach once when lock is enabled)
// ──────────────────────────────────────────────────────

type Handler = (e: Event) => void;
let _keyHandler: Handler | null = null;
let _ctxHandler: Handler | null = null;
let _selHandler: Handler | null = null;

export function attachBrowserLock(): void {
  if (typeof document === 'undefined') return;

  // Calibrate baseline size diff at the moment of locking
  calibrateDevToolsBaseline();

  // Block every keyboard shortcut that opens DevTools / view-source
  _keyHandler = (e: Event) => {
    const ke = e as KeyboardEvent;
    const blocked =
      ke.key === 'F12' ||
      // Chrome/Firefox DevTools
      (ke.ctrlKey && ke.shiftKey && ['I','J','C','K','E'].includes(ke.key.toUpperCase())) ||
      // macOS DevTools
      (ke.metaKey && ke.altKey  && ['I','J'].includes(ke.key.toUpperCase())) ||
      // View source
      (ke.ctrlKey && ke.key.toUpperCase() === 'U') ||
      // Find-in-page rarely matters but Ctrl+F can reveal element positions
      // (leave unblocked — too disruptive for normal use)
      false;
    if (blocked) { e.preventDefault(); e.stopPropagation(); }
  };

  // Disable right-click context menu  (both mouse right-click AND touch long-press)
  _ctxHandler = (e: Event) => { e.preventDefault(); e.stopPropagation(); return false; };

  // Prevent drag-select highlighting (tiny UX cost, hinders element picking)
  _selHandler = (e: Event) => { e.preventDefault(); };

  document.addEventListener('keydown',     _keyHandler, true);
  document.addEventListener('contextmenu', _ctxHandler, true);
  document.addEventListener('selectstart', _selHandler, true);

  // Suppress console output so DevTools Console shows nothing useful
  suppressConsole();
  startConsoleProbe();
}

export function detachBrowserLock(): void {
  if (typeof document === 'undefined') return;
  if (_keyHandler) document.removeEventListener('keydown',     _keyHandler, true);
  if (_ctxHandler) document.removeEventListener('contextmenu', _ctxHandler, true);
  if (_selHandler) document.removeEventListener('selectstart', _selHandler, true);
  _keyHandler = null;
  _ctxHandler = null;
  _selHandler = null;

  restoreConsole();
  stopConsoleProbe();
}
