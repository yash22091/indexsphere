import { describe, expect, it } from 'vitest';
import { Semaphore } from '@/lib/concurrency';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('Semaphore', () => {
  it('never exceeds the limit and runs everything', async () => {
    const sem = new Semaphore(2);
    let active = 0, peak = 0, done = 0;
    await Promise.all(Array.from({ length: 10 }, () => sem.run(5000, async () => {
      active++; peak = Math.max(peak, active);
      await sleep(10);
      active--; done++;
    })));
    expect(peak).toBe(2);
    expect(done).toBe(10);
    expect(sem.inUse).toBe(0);
    expect(sem.queued).toBe(0);
  });

  it('times out waiters without leaking slots', async () => {
    const sem = new Semaphore(1);
    const release = await sem.acquire(100);
    await expect(sem.acquire(30)).rejects.toThrow(/busy/);
    expect(sem.queued).toBe(0);
    release();
    const r2 = await sem.acquire(100); // slot is usable again
    r2();
    expect(sem.inUse).toBe(0);
  });

  it('releases the slot when the task throws', async () => {
    const sem = new Semaphore(1);
    await expect(sem.run(100, async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(sem.inUse).toBe(0);
  });
});
