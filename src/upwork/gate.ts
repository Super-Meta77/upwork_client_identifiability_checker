// NFR-01 / D-13: every Upwork request, job details and attachments alike, passes through one
// serial gate, so at most one request is in flight.

export interface Gate {
  run<T>(task: () => Promise<T>): Promise<T>;
  inFlight(): number;
}

export function createGate(): Gate {
  let tail: Promise<unknown> = Promise.resolve();
  let running = 0;
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const start = async () => {
        running += 1;
        try {
          return await task();
        } finally {
          running -= 1;
        }
      };
      const result = tail.then(start, start);
      tail = result.catch(() => undefined);
      return result;
    },
    inFlight: () => running,
  };
}

/** The gate shared by everything in this extension page. */
export const upworkGate = createGate();
