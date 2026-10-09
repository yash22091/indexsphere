/**
 * Counting semaphore with a bounded wait — caps concurrent use of an expensive
 * resource (e.g. headless Chrome for PDFs) so bursts queue instead of exhausting memory.
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly max: number) {}

  get inUse() { return this.active; }
  get queued() { return this.waiters.length; }

  /** Resolves with a release function, or rejects after timeoutMs in the queue. */
  acquire(timeoutMs: number): Promise<() => void> {
    const release = () => {
      const next = this.waiters.shift();
      if (next) next(); // hand the slot straight to the next waiter
      else this.active--;
    };
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve(release);
    }
    return new Promise((resolve, reject) => {
      const grant = () => {
        clearTimeout(timer);
        resolve(release);
      };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(grant);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error('Server is busy, please retry shortly'));
      }, timeoutMs);
      this.waiters.push(grant);
    });
  }

  async run<T>(timeoutMs: number, fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire(timeoutMs);
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** Process-wide named semaphore (shared across Next.js route bundles). */
export function namedSemaphore(name: string, max: number): Semaphore {
  const g = globalThis as unknown as Record<string, Semaphore>;
  const key = `__INDEXSPHERE_SEM_${name}__`;
  if (!g[key]) g[key] = new Semaphore(max);
  return g[key];
}
