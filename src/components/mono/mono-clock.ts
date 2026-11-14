type Tick = (dt: number) => void;
const subscribers = new Set<Tick>();
let raf = 0;
let last = 0;

function loop(now: number) {
  if (!last) last = now;
  const dt = Math.min((now - last) / 1000, 0.1);
  if (dt >= 1 / 30) {
    last = now;
    if (!document.hidden) subscribers.forEach((fn) => fn(dt));
  }
  raf = subscribers.size ? requestAnimationFrame(loop) : 0;
}

/** One requestAnimationFrame loop for every Mono on the page. */
export function subscribeMonoClock(fn: Tick): () => void {
  subscribers.add(fn);
  if (!raf) {
    last = 0;
    raf = requestAnimationFrame(loop);
  }
  return () => {
    subscribers.delete(fn);
    if (!subscribers.size && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}
