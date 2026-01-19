export type AsyncLock = {
  runExclusive<T>(fn: () => Promise<T>): Promise<T>;
};

class SimpleMutex implements AsyncLock {
  private p: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.p;
    let release!: () => void;
    this.p = new Promise<void>((r) => (release = r));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export const mutex: AsyncLock = new SimpleMutex();
