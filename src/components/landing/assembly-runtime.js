import { createJoineryRenderer } from "./assembly-joinery";

/** Mount only within this landing; the returned disposer also handles React remounts. */
export function mountAssembly(root) {
  const cleanup = [];
  const frames = new Set(),
    timers = new Set();
  let disposed = false;
  function on(target, type, listener, options) {
    if (!target) return;
    target.addEventListener(type, listener, options);
    cleanup.push(() => target.removeEventListener(type, listener, options));
  }
  function requestAnimationFrame(callback) {
    if (disposed) return 0;
    const id = window.requestAnimationFrame((time) => {
      frames.delete(id);
      if (!disposed) callback(time);
    });
    frames.add(id);
    return id;
  }
  function cancelAnimationFrame(id) {
    frames.delete(id);
    window.cancelAnimationFrame(id);
  }
  function setTimeout(callback, delay) {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!disposed) callback();
    }, delay);
    timers.add(id);
    return id;
  }
  const previousScrollBehavior = document.documentElement.style.scrollBehavior;
  const previousScrollPadding = document.documentElement.style.scrollPaddingTop;
  document.documentElement.style.scrollPaddingTop = "106px";

  const $ = (s, scope = root) => scope.querySelector(s);
  const $$ = (s, scope = root) => [...scope.querySelectorAll(s)];
  const clamp = (n, low = 0, high = 1) => Math.min(high, Math.max(low, n));
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const narrow = matchMedia("(max-width: 780px)");
  const coarse = matchMedia("(pointer: coarse)");
  const body = root;
  let paused = reduce.matches;
  let raf = 0;
  let animationTime = 0;
  let lastTime = 0;
  let inView = true;
  let needsPaint = true;
  let joined = false;
  let join = 0;
  let introTarget = 0;
  let dragYaw = 0;
  let dragStart = null;
  const intro = $(".assembly-intro");
  const ease = (n) => {
    const t = clamp(n);
    return t * t * (3 - 2 * t);
  };
  const pointer = { x: 0, y: 0, px: -1000, py: -1000 };
  const smoothPointer = { x: 0, y: 0 };
  const canvas = $("canvas");
  const ctx = canvas?.getContext("2d");
  let joineryRenderer = null;
  if (body.dataset.experience === "assembly") {
    const lighting = document.createElement("canvas");
    lighting.className = "joinery-render";
    lighting.setAttribute("aria-hidden", "true");
    canvas.before(lighting);
    joineryRenderer = createJoineryRenderer(lighting, narrow.matches);
    if (!joineryRenderer) lighting.remove();
    else cleanup.push(() => joineryRenderer.destroy());
  }
  let W = 0,
    H = 0,
    ratio = 1;

  root.classList.add("js-motion");
  const revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          revealObserver.unobserve(entry.target);
        }
    },
    { threshold: 0.08 },
  );
  $$(".reveal").forEach((el) => revealObserver.observe(el));

  function requestFrame() {
    if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function setPaused(value) {
    paused = value;
    body.classList.toggle("paused", value);
    $("[data-motion]").setAttribute("aria-pressed", String(value));
    $("[data-motion]").setAttribute(
      "aria-label",
      value ? "Enable motion" : "Pause motion",
    );
    $("[data-motion-label]").textContent = value
      ? "Motion off"
      : "Pause motion";
    $("[data-motion] span:first-child").textContent = value ? "▷" : "Ⅱ";
    document.documentElement.style.scrollBehavior = value ? "auto" : "smooth";
    if (value) $$(".reveal").forEach((el) => el.classList.add("visible"));
    needsPaint = true;
    updateScroll();
    requestFrame();
  }
  on($("[data-motion]"), "click", () => setPaused(!paused));
  on(reduce, "change", (e) => setPaused(e.matches));

  const toggle = $(".menu-toggle");
  function closeMenu() {
    $("#mobile-nav").classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open navigation");
    toggle.textContent = "☰";
  }
  on(toggle, "click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    $("#mobile-nav").classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute(
      "aria-label",
      open ? "Close navigation" : "Open navigation",
    );
    toggle.textContent = open ? "×" : "☰";
  });
  $$("#mobile-nav a").forEach((a) => on(a, "click", closeMenu));
  on(document, "keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
  on(narrow, "change", closeMenu);

  $$("[data-billing]").forEach((button) =>
    on(button, "click", () => {
      const annual = button.dataset.billing === "annual";
      $('[data-price="core"]').textContent = annual ? "10" : "12";
      $('[data-price="pulse"]').textContent = annual ? "24" : "29";
      $$("[data-billing-note]").forEach(
        (el) =>
          (el.textContent = annual ? "Billed annually" : "Billed monthly"),
      );
      $$("[data-billing]").forEach((el) =>
        el.setAttribute("aria-pressed", String(el === button)),
      );
    }),
  );
  $$(".spotlight").forEach((el) =>
    on(el, "pointermove", (e) => {
      if (paused || coarse.matches) return;
      const box = el.getBoundingClientRect();
      el.style.setProperty("--mouse-x", `${e.clientX - box.left}px`);
      el.style.setProperty("--mouse-y", `${e.clientY - box.top}px`);
    }),
  );
  $$("[data-tilt]").forEach((el) => {
    on(el, "pointermove", (e) => {
      if (paused || coarse.matches) return;
      const box = el.getBoundingClientRect();
      el.style.setProperty(
        "--tilt-x",
        ((e.clientX - box.left) / box.width - 0.5) * 7,
      );
      el.style.setProperty(
        "--tilt-y",
        -((e.clientY - box.top) / box.height - 0.5) * 5,
      );
    });
    on(el, "pointerleave", () => {
      el.style.setProperty("--tilt-x", 0);
      el.style.setProperty("--tilt-y", 0);
    });
  });

  let chapter = 0;
  const story = $(".assembly-story");
  const titles = ["01 / THE BOARD", "02 / THE DETAIL", "03 / THE AGENT DOCK"];
  const captions = [
    "The big picture, without losing the details.",
    "Every decision, still part of the story.",
    "Intelligence, beside the work.",
  ];
  function setChapter(index) {
    chapter = index;
    $$("[data-chapter]").forEach((el) =>
      el.setAttribute("aria-pressed", String(+el.dataset.chapter === index)),
    );
    $$("[data-screen]").forEach((el) => {
      const n = +el.dataset.screen;
      el.classList.toggle("active", n === index);
      el.classList.toggle("prev", n < index);
      el.classList.toggle("next", n > index);
    });
    if ($("[data-screen-index]"))
      $("[data-screen-index]").textContent = titles[index];
    if ($("[data-screen-caption]"))
      $("[data-screen-caption]").textContent = captions[index];
  }
  $$("[data-chapter]").forEach((button) =>
    on(button, "click", () => {
      const index = +button.dataset.chapter;
      setChapter(index);
      if (!narrow.matches && !reduce.matches && story) {
        const distance = story.offsetHeight - (innerHeight - 90);
        const destination =
          scrollY +
          story.getBoundingClientRect().top -
          90 +
          distance * (index / 2);
        window.scrollTo({
          top: destination,
          behavior: paused ? "instant" : "smooth",
        });
      }
    }),
  );
  function updateScroll() {
    if (intro) {
      const rect = intro.getBoundingClientRect();
      if (!narrow.matches && !reduce.matches) {
        introTarget = clamp(-rect.top / (rect.height - innerHeight));
      } else if (!joined) {
        introTarget = reduce.matches
          ? 0.84
          : clamp(
              (innerHeight * 0.45 -
                $(".hero-art").getBoundingClientRect().top) /
                (innerHeight * 0.65),
            ) * 0.84;
      }
      if (paused) join = introTarget;
      needsPaint = true;
      requestFrame();
    }
    const distance = document.documentElement.scrollHeight - innerHeight;
    body.style.setProperty("--scroll", clamp(scrollY / Math.max(1, distance)));
    if (story && !narrow.matches && !reduce.matches) {
      const rect = story.getBoundingClientRect();
      if (rect.top < innerHeight && rect.bottom > 0) {
        const progress = clamp(
          (90 - rect.top) / (story.offsetHeight - (innerHeight - 90)),
        );
        const index = Math.min(2, Math.floor(progress * 2.99));
        if (index !== chapter) setChapter(index);
        if (!paused)
          $(".screen-stage").style.setProperty(
            "--stage-y",
            Math.sin(progress * Math.PI) * -20,
          );
      }
    }
    const fan = $("[data-fan]");
    if (fan && !paused && !narrow.matches) {
      const box = fan.getBoundingClientRect();
      fan.style.setProperty(
        "--fan-y",
        clamp((innerHeight * 0.45 - box.top) * 0.2, -55, 95),
      );
    }
    $$("[data-parallax]").forEach((el) => {
      if (paused || narrow.matches) {
        el.style.setProperty("--parallax", 0);
        return;
      }
      const rect = el.getBoundingClientRect();
      if (rect.top < innerHeight + 100 && rect.bottom > -100)
        el.style.setProperty(
          "--parallax",
          clamp(
            (innerHeight * 0.5 - rect.top - rect.height * 0.5) * 0.1,
            -35,
            35,
          ),
        );
    });
    const words = $$("[data-word]");
    words.forEach((word, i) => {
      const rect = $("[data-word-reveal]").getBoundingClientRect();
      const lit = paused || rect.top < innerHeight * (0.87 - i * 0.065);
      word.style.color = lit ? (i === 4 ? "var(--accent)" : "var(--ink)") : "";
    });
  }
  let scrollQueued = false;
  on(
    window,
    "scroll",
    () => {
      if (scrollQueued) return;
      scrollQueued = true;
      requestAnimationFrame(() => {
        scrollQueued = false;
        updateScroll();
      });
    },
    { passive: true },
  );
  on(window, "resize", updateScroll, { passive: true });

  $$("[data-agent-mode]").forEach((button) =>
    on(button, "click", () => {
      const agent = button.dataset.agentMode === "agent";
      $$("[data-agent-mode]").forEach((el) =>
        el.setAttribute("aria-pressed", String(el === button)),
      );
      $("[data-agent-request]").textContent = agent
        ? "“Create a launch project, assign the owners, and share an update.”"
        : "“Let’s get the next project moving.”";
      $$("[data-event-role]").forEach(
        (el) => (el.textContent = agent ? "AGENT" : "TEAM"),
      );
      $("[data-agent-foot]").textContent = agent
        ? "A compatible external tool can act through MCP, within its authorized access."
        : "One person starts. Everyone can pick up the thread.";
      $$(".event-list li").forEach((el, i) => {
        el.classList.remove("lit");
        if (paused) el.classList.add("lit");
        else setTimeout(() => el.classList.add("lit"), 120 + i * 180);
      });
    }),
  );

  let seed = 19;
  function random() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }
  const particles = Array.from({ length: coarse.matches ? 90 : 200 }, () => ({
    theta: random() * Math.PI * 2,
    radius: 130 + random() * 110,
    y: (random() - 0.5) * 520,
    size: random() * 1.6 + 0.3,
    phase: random() * Math.PI * 2,
  }));
  function resizeCanvas() {
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    ratio = Math.min(devicePixelRatio || 1, coarse.matches ? 1.5 : 2);
    canvas.width = Math.round(W * ratio);
    canvas.height = Math.round(H * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    needsPaint = true;
    requestFrame();
  }
  const sceneObserver = new IntersectionObserver(
    (entries) => {
      inView = entries[0].isIntersecting;
      if (inView) {
        needsPaint = true;
        requestFrame();
      }
    },
    { rootMargin: "60px" },
  );
  if (canvas) {
    sceneObserver.observe(canvas);
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);
    cleanup.push(() => resizeObserver.disconnect());
    const zone =
      body.dataset.experience === "assembly" ? $(".hero-art") : $(".hero-b");
    on(zone, "pointermove", (e) => {
      if (coarse.matches || paused) return;
      const rect = canvas.getBoundingClientRect();
      pointer.px = e.clientX - rect.left;
      pointer.py = e.clientY - rect.top;
      pointer.x = (pointer.px / W - 0.5) * 2;
      pointer.y = (pointer.py / H - 0.5) * 2;
      needsPaint = true;
      requestFrame();
    });
    on(zone, "pointerleave", () => {
      pointer.x = 0;
      pointer.y = 0;
      pointer.px = -1000;
      pointer.py = -1000;
      needsPaint = true;
      requestFrame();
    });
    if (body.dataset.experience === "assembly") {
      canvas.tabIndex = 0;
      canvas.setAttribute(
        "aria-label",
        "Four interlocking graphite pieces. Scroll to assemble. Drag or use the left and right arrow keys to turn.",
      );
      on(canvas, "keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        dragYaw = clamp(
          dragYaw + (e.key === "ArrowLeft" ? -0.15 : 0.15),
          -1.4,
          1.4,
        );
        needsPaint = true;
        requestFrame();
      });
    }
    on(canvas, "pointerdown", (e) => {
      if (paused || e.pointerType !== "mouse") return;
      dragStart = { x: e.clientX, yaw: dragYaw };
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add("dragging");
    });
    on(canvas, "pointermove", (e) => {
      if (!dragStart) return;
      dragYaw = clamp(
        dragStart.yaw + (e.clientX - dragStart.x) * 0.007,
        -1.4,
        1.4,
      );
      needsPaint = true;
      requestFrame();
    });
    const endDrag = () => {
      dragStart = null;
      canvas.classList.remove("dragging");
    };
    on(canvas, "pointerup", endDrag);
    on(canvas, "pointercancel", endDrag);
  }
  const screenDialog = $(".screen-dialog");
  on($("[data-expand-screen]"), "click", () => {
    const source = $(".screen.active img");
    $("[data-dialog-image]").src = source.src;
    $("[data-dialog-image]").alt = source.alt;
    $("[data-dialog-title]").textContent = titles[chapter];
    screenDialog.showModal();
  });
  on($("[data-close-screen]"), "click", () => screenDialog.close());
  on(screenDialog, "click", (e) => {
    if (e.target === screenDialog) screenDialog.close();
  });
  on($("#assemble"), "click", () => {
    joined = join < 0.7;
    if (!narrow.matches && !reduce.matches) {
      const top = scrollY + intro.getBoundingClientRect().top;
      window.scrollTo({
        top: top + (joined ? (intro.offsetHeight - innerHeight) * 0.84 : 0),
        behavior: paused ? "instant" : "smooth",
      });
    } else {
      introTarget = joined ? 0.84 : 0;
      if (paused) join = introTarget;
    }
    needsPaint = true;
    requestFrame();
  });
  on(document, "visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
      lastTime = 0;
    } else {
      needsPaint = true;
      requestFrame();
    }
  });

  // A voxel partition keeps every slot and tenon complementary. Mesh only the
  // outside of each piece; merge coplanar cells so the sculpture has no grid.
  function jointMesh() {
    const size = [6, 10, 4],
      unit = 31,
      groups = new Map();
    function material(x, y, z) {
      if (x < 0 || x >= 6 || y < 0 || y >= 10 || z < 0 || z >= 4) return -1;
      if (y < 2 || (y === 2 && (x === 1 || x === 4) && z > 0 && z < 3))
        return 3;
      if ((y === 4 || y === 5) && x >= 2 && x < 4) return 2;
      const split = y < 4 ? 4 : y < 8 ? 2 : 3;
      return x < split ? 0 : 1;
    }
    for (let x = 0; x < 6; x++)
      for (let y = 0; y < 10; y++)
        for (let z = 0; z < 4; z++) {
          const cell = [x, y, z],
            piece = material(...cell);
          for (let axis = 0; axis < 3; axis++)
            for (const dir of [-1, 1]) {
              const neighbor = [...cell];
              neighbor[axis] += dir;
              if (material(...neighbor) === piece) continue;
              const axes = [0, 1, 2].filter((n) => n !== axis),
                plane = cell[axis] + (dir > 0 ? 1 : 0);
              const id = [piece, axis, dir, plane].join(",");
              if (!groups.has(id))
                groups.set(id, {
                  piece,
                  axis,
                  dir,
                  plane,
                  axes,
                  cells: new Set(),
                });
              groups.get(id).cells.add(cell[axes[0]] + "," + cell[axes[1]]);
            }
        }
    const mesh = [];
    for (const g of groups.values()) {
      const original = new Set(g.cells),
        point = (u, v) => {
          const xyz = [0, 0, 0];
          xyz[g.axis] = g.plane;
          xyz[g.axes[0]] = u;
          xyz[g.axes[1]] = v;
          return xyz.map((n, i) => (n - size[i] / 2) * unit);
        };
      const normal = [0, 0, 0];
      normal[g.axis] = g.dir;
      const edges = [];
      for (const key of original) {
        const [u, v] = key.split(",").map(Number);
        if (!original.has(u - 1 + "," + v))
          edges.push([point(u, v), point(u, v + 1)]);
        if (!original.has(u + 1 + "," + v))
          edges.push([point(u + 1, v), point(u + 1, v + 1)]);
        if (!original.has(u + "," + (v - 1)))
          edges.push([point(u, v), point(u + 1, v)]);
        if (!original.has(u + "," + (v + 1)))
          edges.push([point(u, v + 1), point(u + 1, v + 1)]);
      }
      const quads = [];
      while (g.cells.size) {
        const [u, v] = g.cells.values().next().value.split(",").map(Number);
        let w = 1,
          h = 1;
        while (g.cells.has(u + w + "," + v)) w++;
        outer: while (true) {
          for (let k = 0; k < w; k++)
            if (!g.cells.has(u + k + "," + (v + h))) break outer;
          h++;
        }
        for (let i = 0; i < w; i++)
          for (let j = 0; j < h; j++) g.cells.delete(u + i + "," + (v + j));
        quads.push([
          point(u, v),
          point(u + w, v),
          point(u + w, v + h),
          point(u, v + h),
        ]);
      }
      mesh.push({ piece: g.piece, axis: g.axis, normal, quads, edges });
    }
    return mesh;
  }
  const mesh = body.dataset.experience === "assembly" ? jointMesh() : [];
  function drawAssembly(time) {
    if (!ctx || W === 0 || H === 0) return;
    const reveal = ease((join - 0.88) / 0.12);
    intro.style.setProperty("--workspace-reveal", reveal.toFixed(4));
    intro.style.setProperty("--assembly-progress", join.toFixed(4));
    const phase = join < 0.32 ? 0 : join < 0.88 ? 1 : 2;
    $$("[data-joint-phase]").forEach((el) =>
      el.classList.toggle("active", +el.dataset.jointPhase === phase),
    );
    const button = $("#assemble"),
      isJoined = join > 0.7;
    if (button && button.getAttribute("aria-pressed") !== String(isJoined)) {
      button.setAttribute("aria-pressed", String(isJoined));
      button.innerHTML =
        (isJoined ? "Replay the assembly" : "Assemble the monolith") +
        ' <span aria-hidden="true">' +
        (isJoined ? "↺" : "↓") +
        "</span>";
    }
    ctx.clearRect(0, 0, W, H);
    const scale = Math.min(W / 590, H / 660) * (narrow.matches ? 1.13 : 1.2);
    const cx = W * 0.51,
      cy = H * 0.47;
    const ry = 0.52 + ease(join) * 0.3 + smoothPointer.x * 0.13 + dragYaw;
    const rx = 0.19 + smoothPointer.y * 0.06;
    const co = Math.cos(ry),
      si = Math.sin(ry),
      cox = Math.cos(rx),
      six = Math.sin(rx);
    const rotate = ([x, y, z]) => {
      const a = x * co + z * si,
        b = z * co - x * si;
      return [a, y * cox - b * six, y * six + b * cox];
    };
    const project = (xyz) => {
      const [x, y, z] = rotate(xyz),
        p = 900 / (900 + z);
      return { x: cx + x * scale * p, y: cy + y * scale * p, z, p };
    };
    const offsets = [
      [
        -105 * (1 - ease((join - 0.05) / 0.3)),
        8 * (1 - ease(join / 0.4)),
        25 * (1 - ease(join / 0.35)),
      ],
      [
        110 * (1 - ease((join - 0.24) / 0.33)),
        24 * (1 - ease((join - 0.24) / 0.33)),
        -25 * (1 - ease((join - 0.24) / 0.33)),
      ],
      [0, 0, -170 * (1 - ease((join - 0.64) / 0.2))],
      [0, -112 * (1 - ease((join - 0.43) / 0.27)), 0],
    ];
    if (joineryRenderer?.available)
      joineryRenderer.render({
        width: W,
        height: H,
        offsets: offsets.map((v) => [v[0] * 0.01, -v[1] * 0.01, -v[2] * 0.01]),
        yaw: ry,
        pitch: rx,
        progress: join,
        time,
      });
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.49);
    halo.addColorStop(0, "rgba(78,96,161,.10)");
    halo.addColorStop(1, "rgba(8,11,17,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);
    // Small drifting flecks give depth without covering the precision of the joint.
    particles.forEach((p) => {
      const a = p.theta + time * 0.000015;
      const v = project([
        Math.cos(a) * (p.radius + 70),
        p.y * 0.95,
        Math.sin(a) * (p.radius + 70),
      ]);
      ctx.fillStyle = `rgba(139,157,201,${(0.12 + Math.sin(p.phase + time * 0.00025) * 0.07) * (1 - ease(join) * 0.6)})`;
      ctx.fillRect(
        v.x,
        v.y,
        Math.max(0.7, p.size * scale * 0.65),
        Math.max(0.7, p.size * scale * 0.65),
      );
    });
    ctx.save();
    ctx.translate(cx, cy + 220 * scale);
    ctx.scale(1, 0.18);
    const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, 180 * scale);
    shadow.addColorStop(0, "rgba(85,105,163,.16)");
    shadow.addColorStop(1, "rgba(8,11,17,0)");
    ctx.fillStyle = shadow;
    ctx.fillRect(-220 * scale, -220 * scale, 440 * scale, 440 * scale);
    ctx.restore();
    const faces = [];
    for (const surface of joineryRenderer?.available ? [] : mesh) {
      const normal = rotate(surface.normal);
      if (normal[2] >= -0.001) continue;
      const off = offsets[surface.piece];
      const transform = (v) => project(v.map((n, i) => n + off[i]));
      const polygons = surface.quads.map((q) => q.map(transform));
      const edges = surface.edges.map((edge) => edge.map(transform));
      const depth =
        polygons.flat().reduce((n, v) => n + v.z, 0) / (polygons.length * 4);
      faces.push({ ...surface, normal, polygons, edges, depth });
    }
    faces.sort((a, b) => b.depth - a.depth);
    for (const face of faces) {
      const light = clamp(
        -face.normal[0] * 0.35 - face.normal[1] * 0.7 - face.normal[2] * 0.35,
      );
      const tone = face.piece === 2 ? 12 : face.piece === 3 ? 5 : 0;
      const base = 20 + light * 48 + tone;
      const gradient = ctx.createLinearGradient(
        cx - 130 * scale,
        cy - 210 * scale,
        cx + 100 * scale,
        cy + 220 * scale,
      );
      gradient.addColorStop(0, `rgb(${base + 7},${base + 10},${base + 18})`);
      gradient.addColorStop(0.5, `rgb(${base},${base + 3},${base + 10})`);
      gradient.addColorStop(1, `rgb(${base - 9},${base - 5},${base + 2})`);
      ctx.fillStyle = gradient;
      for (const polygon of face.polygons) {
        ctx.beginPath();
        polygon.forEach((p, i) =>
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
        );
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle =
        face.piece === 2
          ? "rgba(140,158,224,.62)"
          : `rgba(175,186,213,${0.15 + light * 0.25})`;
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      face.edges.forEach(([a, b]) => {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      });
      ctx.stroke();
    }
    // An orbiting construction line makes the camera movement legible.
    ctx.strokeStyle = `rgba(134,151,192,${0.13 * (1 - reveal)})`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const a = (i / 100) * Math.PI * 2,
        p = project([Math.cos(a) * 215, 209, Math.sin(a) * 145]);
      if (i) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    }
    ctx.stroke();
    if (W > 560 && !joineryRenderer?.available) {
      ctx.font = '9px "Monolith Mono",monospace';
      const labels = [
        ["01 / DIRECTION", [-212, -101, -15]],
        ["02 / PEOPLE", [123, 138, -25]],
        ["03 / CONTEXT", [-156, 51, -150]],
      ];
      ctx.globalAlpha = 1 - ease((join - 0.08) / 0.6);
      for (const [text, position] of labels) {
        const p = project(position);
        ctx.fillStyle = "#8592ac";
        ctx.fillText(text, p.x, p.y);
      }
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "center";
    ctx.font = '9px "Monolith Mono",monospace';
    ctx.fillStyle = "#8b96ad";
    ctx.fillText(
      join > 0.81
        ? "THE WHOLE IS MORE THAN ITS PARTS"
        : join > 0.5
          ? "SHARED CONTEXT. THE LOCKING PIECE."
          : "FOUR PARTS. ONE SHARED PURPOSE.",
      cx,
      H * 0.85,
    );
    ctx.textAlign = "left";
  }
  function frame(now) {
    raf = 0;
    const delta = lastTime ? Math.min(now - lastTime, 40) : 16;
    lastTime = now;
    if (!paused) {
      animationTime += delta;
      smoothPointer.x += (pointer.x - smoothPointer.x) * 0.065;
      smoothPointer.y += (pointer.y - smoothPointer.y) * 0.065;
      join += (introTarget - join) * 0.085;
    }
    if (inView && (needsPaint || !paused)) {
      drawAssembly(animationTime);
      needsPaint = false;
    }
    if (inView && !paused && !document.hidden) requestFrame();
  }
  setPaused(paused);
  updateScroll();
  return () => {
    if (disposed) return;
    disposed = true;
    cleanup.reverse().forEach((dispose) => dispose());
    frames.forEach((id) => window.cancelAnimationFrame(id));
    frames.clear();
    timers.forEach((id) => window.clearTimeout(id));
    timers.clear();
    revealObserver.disconnect();
    sceneObserver.disconnect();
    if (screenDialog?.open) screenDialog.close();
    root.classList.remove("js-motion", "paused");
    document.documentElement.style.scrollBehavior = previousScrollBehavior;
    document.documentElement.style.scrollPaddingTop = previousScrollPadding;
  };
}
