const states = new Set([
  "idle",
  "hello",
  "ribbon",
  "listening",
  "thinking",
  "done",
  "needsyou",
  "dozing",
  "wake",
  "ritual",
]);
const lengths = { hello: 2, ribbon: 1.6, done: 2.7, wake: 2, ritual: 3 };
const instances = new WeakMap();
function create(element, options = {}) {
  if (instances.has(element)) return instances.get(element);
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText =
    "display:block;width:100%;height:100%;position:absolute;inset:0;pointer-events:none";
  element.append(canvas);
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) {
    canvas.remove();
    return {
      setState(value) {
        element.dataset.state = value;
      },
      setVisible() {},
      setMotion() {},
      playGesture() {},
      destroy() {},
      getStatus() {
        return { renderer: "artwork", frames: 0 };
      },
    };
  }
  element.dataset.renderer = "canvas";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const personality = { expressiveness: 1.35, glow: 1.5 };
  let state = "idle",
    elapsed = 0,
    blinkAge = 0,
    nextBlink = 5,
    hover = 0,
    pointerX = 0,
    pointerY = 0;
  let visible = true,
    intersecting = true,
    enabled = options.motion !== false,
    destroyed = false;
  let width = 80,
    height = 96,
    raf = 0,
    last = 0,
    frames = 0;
  const cleanup = [];
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const smooth = (x) => {
    x = clamp(x);
    return x * x * (3 - 2 * x);
  };
  const pulse = (t, start, duration) =>
    Math.sin(Math.PI * clamp((t - start) / duration));

  function path(points) {
    ctx.beginPath();
    for (const p of points) {
      if (p[0] === "M") ctx.moveTo(p[1], p[2]);
      else if (p[0] === "L") ctx.lineTo(p[1], p[2]);
      else if (p[0] === "C") ctx.bezierCurveTo(...p.slice(1));
      else if (p[0] === "Q") ctx.quadraticCurveTo(...p.slice(1));
      else ctx.closePath();
    }
  }
  const shell = [
    ["M", -91, -49],
    ["C", -87, -72, -53, -81, -15, -85],
    ["C", 23, -89, 69, -84, 85, -71],
    ["C", 101, -58, 109, -11, 108, 22],
    ["C", 109, 58, 97, 78, 71, 86],
    ["C", 37, 96, -53, 94, -79, 75],
    ["C", -101, 59, -103, -11, -91, -49],
    ["Z"],
  ];
  const face = [
    ["M", -84, -40],
    ["C", -78, -58, -44, -65, -12, -67],
    ["C", 22, -71, 61, -67, 76, -54],
    ["C", 88, -43, 95, -9, 90, 18],
    ["C", 86, 42, 56, 54, 19, 58],
    ["C", -23, 62, -65, 52, -76, 36],
    ["C", -89, 19, -91, -17, -84, -40],
    ["Z"],
  ];
  const belt = [
    ["M", -92, 53],
    ["C", -73, 73, -26, 80, 19, 77],
    ["C", 61, 76, 90, 65, 101, 47],
  ];
  function pose(t) {
    const lengths = { ribbon: 1.6, hello: 2, done: 2.7, wake: 2, ritual: 3 };
    const motion = lengths[state] && t > lengths[state] ? "idle" : state;
    let p = {
      r: 0,
      y: 0,
      x: 0,
      sx: 1,
      sy: 1,
      eye: 1,
      lEye: 1,
      rEye: 1,
      ex: 0,
      ey: 0,
      happy: 0,
      smile: 1,
      light: 0.42,
      think: 0,
    };
    const a = personality.expressiveness;
    if (motion === "ribbon") {
      p.light = 0.5 + 1.1 * pulse(t, 0, 0.6) + 0.8 * pulse(t, 0.68, 0.55);
      p.y = -7 * pulse(t, 0, 1.3);
      p.eye = 1 + 0.17 * pulse(t, 0, 0.6);
      p.happy = 0.5 * pulse(t, 0.68, 0.55);
    }
    if (motion === "hello") {
      p.y = -20 * pulse(t, 0.08, 0.85);
      p.r = -0.13 * pulse(t, 0.3, 0.65) + 0.08 * pulse(t, 0.95, 0.5);
      p.sx = 1 + 0.08 * pulse(t, 0, 0.3);
      p.sy =
        1 -
        0.08 * pulse(t, 0, 0.3) +
        0.055 * pulse(t, 0.3, 0.35) -
        0.04 * pulse(t, 0.9, 0.25);
      p.eye = 1 + 0.2 * pulse(t, 0.1, 0.85);
      p.smile = 1.35;
      p.light = 0.5 + 0.8 * pulse(t, 0, 1.6);
    }
    if (motion === "listening") {
      p.r = -0.11;
      p.y = -6 + Math.sin(t * 1.8);
      p.x = 3;
      p.ex = 5;
      p.ey = -4;
      p.sx = 1.025;
      p.sy = 1.025;
      p.eye = 1.15;
      p.light = 0.95;
    }
    if (motion === "thinking") {
      p.r = -0.095 + Math.sin(t * 2.2) * 0.025;
      p.y = -4 + Math.sin(t * 2.2) * 1.8;
      p.ex = -10;
      p.ey = -10;
      p.rEye = 0.58;
      p.think = 1;
      p.light = 0.85;
    }
    if (motion === "done") {
      p.y = -25 * pulse(t, 0.2, 0.75) - 12 * pulse(t, 1.05, 0.55);
      p.sy =
        1 -
        0.09 * pulse(t, 0, 0.24) +
        0.065 * pulse(t, 0.27, 0.3) -
        0.07 * pulse(t, 0.89, 0.22) +
        0.035 * pulse(t, 1.13, 0.24) -
        0.035 * pulse(t, 1.59, 0.2);
      p.sx = 2 - p.sy;
      p.happy = pulse(t, 0.12, 2.2);
      p.light = 0.5 + 0.95 * pulse(t, 0.9, 0.42) + 0.8 * pulse(t, 1.55, 0.42);
      p.r = -0.09 * pulse(t, 0.3, 0.8) + 0.065 * pulse(t, 1.15, 0.55);
    }
    if (motion === "needsyou") {
      p.r = 0.16;
      p.ex = 6;
      p.ey = -4;
      p.lEye = 0.48;
      p.rEye = 1.23;
      p.smile = 0.2;
      p.light = 0.67;
    }
    if (motion === "dozing") {
      const v = smooth(t / 1.2);
      p.y = 5 * v;
      p.sy = 1 - 0.035 * v;
      p.eye = 1 - 0.92 * v;
      p.ey = 5 * v;
      p.light = 0.42 - 0.3 * v;
      p.r = -0.025 * v;
    }
    if (motion === "wake") {
      const v = smooth(t / 0.45);
      p.eye = 0.08 + 0.92 * v + 0.2 * pulse(t, 0.5, 0.65);
      p.sy = 1 + 0.12 * pulse(t, 0.25, 0.75);
      p.sx = 1 - 0.06 * pulse(t, 0.25, 0.75);
      p.y = -11 * pulse(t, 0.35, 0.8);
      p.r = -0.065 * pulse(t, 0.8, 0.65);
      p.light = 0.5 + 0.85 * pulse(t, 0.3, 1.1);
    }
    if (motion === "ritual") {
      p.r =
        0.26 * pulse(t, 0.05, 0.85) -
        0.15 * pulse(t, 0.9, 0.6) +
        0.065 * pulse(t, 1.52, 0.42);
      p.x = 17 * pulse(t, 0.05, 0.85) - 8 * pulse(t, 0.9, 0.6);
      p.y = -7 * pulse(t, 0.05, 0.85) - 10 * pulse(t, 1.55, 0.6);
      p.ex = -9 * pulse(t, 0.1, 0.7);
      p.eye = 1 + 0.22 * pulse(t, 0.55, 0.45);
      p.sy = 1 - 0.065 * pulse(t, 2.1, 0.3);
      p.sx = 2 - p.sy;
      p.happy = 0.9 * pulse(t, 1.95, 0.8);
      p.light = 0.5 + 0.9 * pulse(t, 2.1, 0.6);
    }
    if (motion === "idle") {
      p.eye = 1 - 0.96 * Math.sin(Math.PI * clamp(blinkAge / 0.16));
      p.y = -2.8 + Math.sin(t * 1.7) * 2.8;
      p.r = Math.sin(t * 1.05) * 0.018;
      p.sy = 1 + Math.sin(t * 1.7) * 0.008;
      p.light = 0.5 + Math.sin(t * 1.7) * 0.07;
      const moment = t % 18;
      p.ex = 7 * pulse(moment, 5, 2.2) - 5 * pulse(moment, 13, 2);
      p.ey = -3 * pulse(moment, 5, 2.2);
    }
    if (["listening", "thinking", "needsyou"].includes(motion) && blinkAge > 0)
      p.eye = 1 - 0.96 * Math.sin(Math.PI * clamp(blinkAge / 0.16));
    if (hover && ["idle", "hello"].includes(motion)) {
      p.ex += pointerX * 10;
      p.ey += pointerY * 6;
      p.y -= 5;
      p.r += pointerX * 0.055;
      p.light += 0.45;
    }
    p.r *= a;
    p.x *= a;
    p.y *= a;
    p.sx = 1 + (p.sx - 1) * a;
    p.sy = 1 + (p.sy - 1) * a;
    return p;
  }
  function drawMono(x, y, scale, p, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    const lift = Math.max(0, -p.y),
      poolWidth = 86 + lift * 1.5,
      poolPower = Math.min(1, p.light * 0.72 * personality.glow);
    ctx.save();
    ctx.translate(p.x * 0.25, 106);
    ctx.scale(1, 0.24);
    let pool = ctx.createRadialGradient(0, 0, 0, 0, 0, poolWidth);
    pool.addColorStop(0, "rgba(125,157,255," + 0.62 * poolPower + ")");
    pool.addColorStop(0.27, "rgba(65,111,255," + 0.42 * poolPower + ")");
    pool.addColorStop(0.64, "rgba(47,82,255," + 0.18 * poolPower + ")");
    pool.addColorStop(1, "rgba(39,70,245,0)");
    ctx.fillStyle = pool;
    ctx.fillRect(-poolWidth, -poolWidth, poolWidth * 2, poolWidth * 2);
    ctx.restore();
    ctx.translate(p.x, p.y + 70);
    ctx.rotate(p.r);
    ctx.scale(p.sx, p.sy);
    ctx.translate(0, -70);
    path(shell);
    let g = ctx.createLinearGradient(-92, -85, 100, 91);
    g.addColorStop(0, "#79808c");
    g.addColorStop(0.12, "#454c57");
    g.addColorStop(0.34, "#2c323d");
    g.addColorStop(0.68, "#171c24");
    g.addColorStop(0.91, "#313946");
    g.addColorStop(1, "#171c24");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "#788192";
    ctx.lineWidth = 0.65;
    ctx.stroke();
    path([
      ["M", 85, -71],
      ["C", 101, -58, 109, -11, 108, 22],
      ["C", 109, 58, 97, 78, 71, 86],
      ["C", 91, 58, 95, 1, 83, -32],
      ["C", 80, -51, 84, -63, 85, -71],
      ["Z"],
    ]);
    g = ctx.createLinearGradient(75, 0, 110, 0);
    g.addColorStop(0, "rgba(38,46,62,.2)");
    g.addColorStop(0.65, "rgba(58,78,116,.45)");
    g.addColorStop(1, "rgba(108,138,236,.6)");
    ctx.fillStyle = g;
    ctx.fill();
    path(face);
    g = ctx.createLinearGradient(-50, -67, 47, 58);
    g.addColorStop(0, "#222b36");
    g.addColorStop(0.31, "#0b1017");
    g.addColorStop(0.7, "#04070b");
    g.addColorStop(1, "#101720");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#10151d";
    ctx.stroke();
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = "#788293";
    ctx.stroke();
    ctx.save();
    path(face);
    ctx.clip();
    g = ctx.createLinearGradient(-80, -60, -15, 14);
    g.addColorStop(0, "rgba(236,245,255,.25)");
    g.addColorStop(0.4, "rgba(236,245,255,.025)");
    g.addColorStop(1, "rgba(236,245,255,0)");
    ctx.fillStyle = g;
    path([
      ["M", -100, -60],
      ["Q", -15, -105, 88, -43],
      ["Q", -43, -63, -95, 20],
      ["Z"],
    ]);
    ctx.fill();
    ctx.restore();
    ctx.save();
    path(belt);
    ctx.strokeStyle = "#5277ff";
    ctx.lineWidth = 16;
    ctx.globalAlpha = clamp(0.25 * p.light * personality.glow);
    ctx.shadowColor = "#5277ff";
    ctx.shadowBlur = 32 * p.light * personality.glow;
    ctx.stroke();
    ctx.restore();
    path(belt);
    ctx.strokeStyle = "#101833";
    ctx.lineWidth = 9;
    ctx.stroke();
    path(belt);
    g = ctx.createLinearGradient(-90, 0, 104, 0);
    g.addColorStop(0, "#3750a9");
    g.addColorStop(0.4, "#688aff");
    g.addColorStop(0.72, "#7395ff");
    g.addColorStop(1, "#abc2ff");
    ctx.strokeStyle = g;
    ctx.lineWidth = 4;
    ctx.globalAlpha = clamp(p.light * personality.glow);
    ctx.shadowColor = "#5277ff";
    ctx.shadowBlur = 24 * p.light;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    if (p.think) {
      ctx.save();
      path(belt);
      ctx.lineWidth = 3;
      const phase = (t * 0.38) % 1,
        cx = -115 + phase * 250;
      g = ctx.createLinearGradient(cx - 30, 0, cx + 30, 0);
      g.addColorStop(0, "rgba(170,190,255,0)");
      g.addColorStop(0.5, "rgba(193,208,255,.98)");
      g.addColorStop(1, "rgba(170,190,255,0)");
      ctx.strokeStyle = g;
      ctx.shadowColor = "#6488ff";
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(p.ex, p.ey);
    ctx.rotate(-0.075);
    for (const ex of [-37, 30]) {
      const ey = ex < 0 ? -7 : -9,
        glowPower =
          Math.min(1.2, (0.48 + p.light * 0.35) * personality.glow) *
          Math.max(0.15, p.eye);
      let bloom = ctx.createRadialGradient(ex, ey, 2, ex, ey, 34);
      bloom.addColorStop(0, "rgba(255,237,181," + 0.28 * glowPower + ")");
      bloom.addColorStop(0.36, "rgba(255,226,160," + 0.16 * glowPower + ")");
      bloom.addColorStop(1, "rgba(255,218,149,0)");
      ctx.fillStyle = bloom;
      ctx.fillRect(ex - 34, ey - 34, 68, 68);
    }
    ctx.fillStyle = "#fff9e9";
    ctx.strokeStyle = "#fff9e9";
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(255,230,161,.9)";
    ctx.shadowBlur = 22 * personality.glow;
    for (let i = 0; i < 2; i++) {
      const ex = i === 0 ? -37 : 30,
        ey = i === 0 ? -7 : -9;
      const openness = Math.max(0.055, p.eye * (i === 0 ? p.lEye : p.rEye));
      if (p.happy > 0.25) {
        ctx.beginPath();
        ctx.moveTo(ex - 10, ey + 4);
        ctx.quadraticCurveTo(ex, ey - 12 * p.happy, ex + 10, ey + 4);
        ctx.lineWidth = 5;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.ellipse(ex, ey, 9, 18 * openness, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.moveTo(-16, 24);
    ctx.quadraticCurveTo(-1, 24 + 13 * p.smile, 13, 22);
    ctx.lineWidth = 3.4;
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  function canAnimate() {
    return (
      enabled &&
      !reduced.matches &&
      visible &&
      intersecting &&
      !document.hidden &&
      !destroyed
    );
  }
  function draw() {
    if (destroyed || !visible || !width || !height) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawMono(
      width * 0.49,
      height * 0.44,
      Math.min(width / 255, height / 270),
      pose(elapsed),
      elapsed,
    );
    frames++;
    element.dataset.frames = String(frames);
    element.dataset.state = state;
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
  }
  function loop(now) {
    if (!canAnimate()) {
      stop();
      return;
    }
    if (!last) last = now;
    const dt = Math.min((now - last) / 1000, 0.1);
    if (dt >= 1 / 30) {
      last = now;
      elapsed += dt;
      if (lengths[state] && elapsed > lengths[state]) {
        state = "idle";
        elapsed = 0;
      }
      if (blinkAge > 0) {
        blinkAge += dt;
        if (blinkAge > 0.16) blinkAge = 0;
      } else {
        nextBlink -= dt;
        if (nextBlink <= 0) {
          blinkAge = 0.001;
          nextBlink = 4.5 + Math.random() * 4;
        }
      }
      draw();
    }
    raf = requestAnimationFrame(loop);
  }
  function sync() {
    element.dataset.motion = canAnimate() ? "running" : "paused";
    if (canAnimate()) {
      if (!raf) raf = requestAnimationFrame(loop);
    } else {
      stop();
      if (reduced.matches) {
        blinkAge = 0;
      }
      draw();
    }
  }
  function resize() {
    const rect = element.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    draw();
    sync();
  }
  function on(target, event, listener) {
    target.addEventListener(event, listener);
    cleanup.push(() => target.removeEventListener(event, listener));
  }
  on(element, "pointermove", (event) => {
    const r = element.getBoundingClientRect();
    hover = 1;
    pointerX = clamp((event.clientX - r.left - width / 2) / (width / 2), -1, 1);
    pointerY = clamp(
      (event.clientY - r.top - height / 2) / (height / 2),
      -1,
      1,
    );
    if (!canAnimate()) draw();
  });
  on(element, "pointerleave", () => {
    hover = 0;
    if (!canAnimate()) draw();
  });
  on(document, "visibilitychange", sync);
  on(reduced, "change", sync);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(element);
  const intersectionObserver = new IntersectionObserver((entries) => {
    intersecting = entries[0].isIntersecting;
    sync();
  });
  intersectionObserver.observe(element);
  const api = {
    setState(value) {
      if (destroyed) return;
      state = states.has(value) ? value : "idle";
      elapsed = canAnimate() ? 0 : 1.1;
      blinkAge = 0;
      draw();
      sync();
    },
    setVisible(value) {
      visible = !!value;
      sync();
    },
    setMotion(value) {
      enabled = !!value;
      sync();
    },
    playGesture(value = "hello") {
      api.setState(value);
    },
    getStatus() {
      return {
        state,
        motion: canAnimate(),
        frames,
        renderer: "canvas",
        destroyed,
      };
    },
    destroy() {
      if (destroyed) return;
      stop();
      destroyed = true;
      cleanup.forEach((fn) => fn());
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      canvas.remove();
      delete element.dataset.renderer;
      instances.delete(element);
    },
  };
  instances.set(element, api);
  resize();
  return api;
}
export { create };
