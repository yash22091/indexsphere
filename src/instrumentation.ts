/**
 * Next.js server start hook — runs once per server process.
 * Starts background jobs (scheduled reports, vulnerability-feed refresh, retention).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('./lib/scheduler');
    startScheduler();
  }
}
