import { LIBRARY_CONFIG } from '../config/library.config.js';

/**
 * Semáforo liviano en memoria para limitar la concurrencia de operaciones pesadas
 * (como validación de streams de Cloudflare R2 en el proceso Node.js).
 */
export class Semaphore {
  private current = 0;
  private queue: Array<{
    resolve: (release: () => void) => void;
    reject: (err: any) => void;
    timer: NodeJS.Timeout;
  }> = [];

  constructor(
    private max: number,
    private timeoutMs: number
  ) {}

  async acquire(): Promise<() => void> {
    if (this.current < this.max) {
      this.current++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          this.release();
        }
      };
    }

    return new Promise<() => void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex((item) => item.timer === timer);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          const err = new Error(
            'El servidor está procesando múltiples archivos en este momento. Reintentando...'
          );
          Object.assign(err, { status: 503, code: 'LIBRARY_BUSY', retryAfter: 2 });
          reject(err);
        }
      }, this.timeoutMs);

      this.queue.push({
        resolve: (releaseFn) => {
          clearTimeout(timer);
          resolve(releaseFn);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      });
    });
  }

  async runWithLock<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private release(): void {
    this.current--;
    if (this.queue.length > 0 && this.current < this.max) {
      const next = this.queue.shift();
      if (next) {
        this.current++;
        let released = false;
        next.resolve(() => {
          if (!released) {
            released = true;
            this.release();
          }
        });
      }
    }
  }

  getActiveCount(): number {
    return this.current;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}

export const validationSemaphore = new Semaphore(
  LIBRARY_CONFIG.SEMAPHORE_CONCURRENCY,
  LIBRARY_CONFIG.SEMAPHORE_TIMEOUT_MS
);
