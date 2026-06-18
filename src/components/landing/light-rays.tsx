"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { Mesh, Program, Renderer, Triangle } from "ogl";

/**
 * WebGL volumetric "light rays" backdrop for the landing hero. Ported from
 * ReactBits' LightRays (OGL); the GLSL is kept verbatim. Self-contained client
 * component — owns its renderer, pointer tracking, resize and animation frame,
 * all torn down on unmount.
 *
 * Production safeguards:
 *  - Under prefers-reduced-motion it renders a single static frame (no rAF loop,
 *    no pointer listener).
 *  - An IntersectionObserver pauses the loop while the hero is off-screen.
 *  - On SSR / jsdom (no WebGL context) the renderer throws on construction; we
 *    swallow it and the component degrades to an inert decorative container.
 */

type RaysOrigin =
  | "top-center"
  | "top-left"
  | "top-right"
  | "left"
  | "right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type LightRaysProps = {
  raysOrigin?: RaysOrigin;
  raysColor?: string;
  raysSpeed?: number;
  lightSpread?: number;
  rayLength?: number;
  pulsating?: boolean;
  fadeDistance?: number;
  saturation?: number;
  followMouse?: boolean;
  mouseInfluence?: number;
  noiseAmount?: number;
  distortion?: number;
  className?: string;
};

type Vec2 = [number, number];
type Vec3 = [number, number, number];

interface Uniforms {
  iTime: { value: number };
  iResolution: { value: Vec2 };
  rayPos: { value: Vec2 };
  rayDir: { value: Vec2 };
  raysColor: { value: Vec3 };
  raysSpeed: { value: number };
  lightSpread: { value: number };
  rayLength: { value: number };
  pulsating: { value: number };
  fadeDistance: { value: number };
  saturation: { value: number };
  mousePos: { value: Vec2 };
  mouseInfluence: { value: number };
  noiseAmount: { value: number };
  distortion: { value: number };
}

const DEFAULT_COLOR = "#bcc4ff";

function hexToRgb(hex: string): Vec3 {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m
    ? [
        parseInt(m[1], 16) / 255,
        parseInt(m[2], 16) / 255,
        parseInt(m[3], 16) / 255,
      ]
    : [1, 1, 1];
}

function getAnchorAndDir(
  origin: RaysOrigin,
  w: number,
  h: number,
): { anchor: Vec2; dir: Vec2 } {
  const outside = 0.2;
  switch (origin) {
    case "top-left":
      return { anchor: [0, -outside * h], dir: [0, 1] };
    case "top-right":
      return { anchor: [w, -outside * h], dir: [0, 1] };
    case "left":
      return { anchor: [-outside * w, 0.5 * h], dir: [1, 0] };
    case "right":
      return { anchor: [(1 + outside) * w, 0.5 * h], dir: [-1, 0] };
    case "bottom-left":
      return { anchor: [0, (1 + outside) * h], dir: [0, -1] };
    case "bottom-center":
      return { anchor: [0.5 * w, (1 + outside) * h], dir: [0, -1] };
    case "bottom-right":
      return { anchor: [w, (1 + outside) * h], dir: [0, -1] };
    default: // "top-center"
      return { anchor: [0.5 * w, -outside * h], dir: [0, 1] };
  }
}

const VERT = `attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAG = `precision highp float;

uniform float iTime;
uniform vec2  iResolution;

uniform vec2  rayPos;
uniform vec2  rayDir;
uniform vec3  raysColor;
uniform float raysSpeed;
uniform float lightSpread;
uniform float rayLength;
uniform float pulsating;
uniform float fadeDistance;
uniform float saturation;
uniform vec2  mousePos;
uniform float mouseInfluence;
uniform float noiseAmount;
uniform float distortion;

varying vec2 vUv;

float noise(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord,
                  float seedA, float seedB, float speed) {
  vec2 sourceToCoord = coord - raySource;
  vec2 dirNorm = normalize(sourceToCoord);
  float cosAngle = dot(dirNorm, rayRefDirection);

  float distortedAngle = cosAngle + distortion * sin(iTime * 2.0 + length(sourceToCoord) * 0.01) * 0.2;

  float spreadFactor = pow(max(distortedAngle, 0.0), 1.0 / max(lightSpread, 0.001));

  float distance = length(sourceToCoord);
  float maxDistance = iResolution.x * rayLength;
  float lengthFalloff = clamp((maxDistance - distance) / maxDistance, 0.0, 1.0);

  float fadeFalloff = clamp((iResolution.x * fadeDistance - distance) / (iResolution.x * fadeDistance), 0.5, 1.0);
  float pulse = pulsating > 0.5 ? (0.8 + 0.2 * sin(iTime * speed * 3.0)) : 1.0;

  float baseStrength = clamp(
    (0.45 + 0.15 * sin(distortedAngle * seedA + iTime * speed)) +
    (0.3 + 0.2 * cos(-distortedAngle * seedB + iTime * speed)),
    0.0, 1.0
  );

  return baseStrength * lengthFalloff * fadeFalloff * spreadFactor * pulse;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = vec2(fragCoord.x, iResolution.y - fragCoord.y);

  vec2 finalRayDir = rayDir;
  if (mouseInfluence > 0.0) {
    vec2 mouseScreenPos = mousePos * iResolution.xy;
    vec2 mouseDirection = normalize(mouseScreenPos - rayPos);
    finalRayDir = normalize(mix(rayDir, mouseDirection, mouseInfluence));
  }

  vec4 rays1 = vec4(1.0) *
               rayStrength(rayPos, finalRayDir, coord, 36.2214, 21.11349,
                           1.5 * raysSpeed);
  vec4 rays2 = vec4(1.0) *
               rayStrength(rayPos, finalRayDir, coord, 22.3991, 18.0234,
                           1.1 * raysSpeed);

  fragColor = rays1 * 0.5 + rays2 * 0.4;

  if (noiseAmount > 0.0) {
    float n = noise(coord * 0.01 + iTime * 0.1);
    fragColor.rgb *= (1.0 - noiseAmount + noiseAmount * n);
  }

  float brightness = 1.0 - (coord.y / iResolution.y);
  fragColor.x *= 0.1 + brightness * 0.8;
  fragColor.y *= 0.3 + brightness * 0.6;
  fragColor.z *= 0.5 + brightness * 0.5;

  if (saturation != 1.0) {
    float gray = dot(fragColor.rgb, vec3(0.299, 0.587, 0.114));
    fragColor.rgb = mix(vec3(gray), fragColor.rgb, saturation);
  }

  fragColor.rgb *= raysColor;
}

void main() {
  vec4 color;
  mainImage(color, gl_FragCoord.xy);
  gl_FragColor  = color;
}`;

export function LightRays({
  raysOrigin = "top-center",
  raysColor = DEFAULT_COLOR,
  raysSpeed = 1.1,
  lightSpread = 0.62,
  rayLength = 2.6,
  pulsating = false,
  fadeDistance = 1.15,
  saturation = 1.0,
  followMouse = true,
  mouseInfluence = 0.15,
  noiseAmount = 0.09,
  distortion = 0.06,
  className,
}: LightRaysProps) {
  const reduce = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // OGL constructs a real WebGL context; on SSR/jsdom this throws. Degrade to
    // an inert container rather than crashing the page or the test runner.
    let renderer: Renderer;
    try {
      renderer = new Renderer({
        dpr: Math.min(window.devicePixelRatio || 1, 2),
        alpha: true,
      });
    } catch {
      return;
    }

    const gl = renderer.gl;
    gl.canvas.style.width = "100%";
    gl.canvas.style.height = "100%";
    gl.canvas.style.display = "block";
    container.appendChild(gl.canvas);

    const uniforms: Uniforms = {
      iTime: { value: 0 },
      iResolution: { value: [1, 1] },
      rayPos: { value: [0, 0] },
      rayDir: { value: [0, 1] },
      raysColor: { value: hexToRgb(raysColor) },
      raysSpeed: { value: raysSpeed },
      lightSpread: { value: lightSpread },
      rayLength: { value: rayLength },
      pulsating: { value: pulsating ? 1.0 : 0.0 },
      fadeDistance: { value: fadeDistance },
      saturation: { value: saturation },
      mousePos: { value: [0.5, 0.5] },
      mouseInfluence: { value: mouseInfluence },
      noiseAmount: { value: noiseAmount },
      distortion: { value: distortion },
    };

    const mesh = new Mesh(gl, {
      geometry: new Triangle(gl),
      program: new Program(gl, {
        vertex: VERT,
        fragment: FRAG,
        uniforms,
      }),
    });

    function place() {
      renderer.dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = container?.clientWidth ?? 0;
      const h = container?.clientHeight ?? 0;
      renderer.setSize(w, h);
      const dpr = renderer.dpr;
      const pw = w * dpr;
      const ph = h * dpr;
      uniforms.iResolution.value = [pw, ph];
      const { anchor, dir } = getAnchorAndDir(raysOrigin, pw, ph);
      uniforms.rayPos.value = anchor;
      uniforms.rayDir.value = dir;
    }

    place();
    window.addEventListener("resize", place);

    // Reduced motion: one static frame, no loop, no pointer tracking.
    if (reduce) {
      renderer.render({ scene: mesh });
      return () => {
        window.removeEventListener("resize", place);
        teardown(renderer, container);
      };
    }

    const mouse = { x: 0.5, y: 0.5 };
    const smooth = { x: 0.5, y: 0.5 };
    let raf = 0;
    let start = 0;
    let visible = true;

    function loop(t: number) {
      if (!start) start = t;
      uniforms.iTime.value = (t - start) * 0.001;
      if (followMouse && mouseInfluence > 0.0) {
        smooth.x = smooth.x * 0.92 + mouse.x * 0.08;
        smooth.y = smooth.y * 0.92 + mouse.y * 0.08;
        uniforms.mousePos.value = [smooth.x, smooth.y];
      }
      renderer.render({ scene: mesh });
      raf = window.requestAnimationFrame(loop);
    }

    function onMove(e: PointerEvent) {
      const r = container?.getBoundingClientRect();
      if (!r || r.width === 0 || r.height === 0) return;
      mouse.x = (e.clientX - r.left) / r.width;
      mouse.y = (e.clientY - r.top) / r.height;
    }

    function startLoop() {
      if (!raf) raf = window.requestAnimationFrame(loop);
    }
    function stopLoop() {
      if (raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
    }

    window.addEventListener("pointermove", onMove);

    // Pause the render loop while the hero is scrolled out of view.
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          visible = entries[0]?.isIntersecting ?? true;
          if (visible) startLoop();
          else stopLoop();
        },
        { threshold: 0 },
      );
      observer.observe(container);
    }

    startLoop();

    return () => {
      stopLoop();
      window.removeEventListener("resize", place);
      window.removeEventListener("pointermove", onMove);
      observer?.disconnect();
      teardown(renderer, container);
    };
  }, [
    reduce,
    raysOrigin,
    raysColor,
    raysSpeed,
    lightSpread,
    rayLength,
    pulsating,
    fadeDistance,
    saturation,
    followMouse,
    mouseInfluence,
    noiseAmount,
    distortion,
  ]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={className}
      style={{ position: "absolute", inset: 0 }}
    />
  );
}

function teardown(renderer: Renderer, container: HTMLElement) {
  try {
    const canvas = renderer.gl.canvas;
    const lose = renderer.gl.getExtension("WEBGL_lose_context");
    lose?.loseContext();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    else if (container.contains(canvas)) container.removeChild(canvas);
  } catch {
    // best-effort cleanup; never throw during unmount
  }
}
