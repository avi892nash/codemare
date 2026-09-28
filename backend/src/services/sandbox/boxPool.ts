/**
 * Async semaphore over a fixed range of isolate box IDs. Acquire blocks when
 * all slots are in use. Always release in a finally so a thrown adapter does
 * not leak the slot.
 *
 * `firstId` offsets the range so two pools can hand out disjoint box IDs (the
 * isolate adapter keeps compile boxes in their own pool — see isolateAdapter).
 */
export class BoxPool {
  private readonly free: number[];
  private readonly waiters: Array<(id: number) => void> = [];

  constructor(maxBoxes: number, firstId = 0) {
    if (maxBoxes < 1) {
      throw new Error(`BoxPool requires maxBoxes >= 1, got ${maxBoxes}`);
    }
    this.free = Array.from({ length: maxBoxes }, (_, i) => firstId + i);
  }

  /**
   * Resolve with a free box ID. `onWait` is called synchronously — before
   * this returns — only when the caller has to queue for a slot; the run
   * service turns that into the SSE `queued` event.
   */
  acquire(onWait?: () => void): Promise<number> {
    const next = this.free.pop();
    if (next !== undefined) {
      return Promise.resolve(next);
    }
    onWait?.();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release(id: number): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(id);
      return;
    }
    this.free.push(id);
  }

  inFlight(): number {
    return this.waiters.length + (this.capacity() - this.free.length);
  }

  capacity(): number {
    return this.free.length + this.waiters.length;
  }
}
