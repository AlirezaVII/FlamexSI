// Global "something is loading" counter behind the top progress bar.
// Route changes and every API request call start()/done(); the bar shows while > 0.

type Listener = (active: number) => void;

let active = 0;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l(active));
}

export const progress = {
  start() {
    active += 1;
    emit();
  },
  done() {
    active = Math.max(0, active - 1);
    emit();
  },
  /** Wrap a promise so the bar runs while it is pending. */
  track<T>(promise: Promise<T>): Promise<T> {
    progress.start();
    return promise.finally(progress.done);
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
