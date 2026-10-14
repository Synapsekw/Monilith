import { mount, createHttpTransport } from "./assembly-mono/widget";

/** Keep Mono attached to this landing and yield the screen to the product viewer. */
export function mountMono(root, signedIn = false) {
  const mono = mount({
    container: root,
    fallbackImage: "/landing/assembly/mono-pebble.png",
    transport: createHttpTransport({ endpoint: "/api/mono" }),
    links: {
      product: "#product",
      agents: "#agents",
      pricing: "#pricing",
      signup: signedIn ? "/" : "/signup",
    },
    motionAllowed: !matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
  const viewer = root.querySelector(".screen-dialog");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const sync = () => {
    const viewing = Boolean(viewer?.open);
    if (viewing) mono.close();
    mono.element.hidden = viewing;
    mono.setMotionAllowed(
      !viewing && !reduced.matches && !root.classList.contains("paused"),
    );
  };
  const observer = new MutationObserver(sync);
  observer.observe(root, { attributes: true, attributeFilter: ["class"] });
  if (viewer)
    observer.observe(viewer, { attributes: true, attributeFilter: ["open"] });
  reduced.addEventListener("change", sync);
  sync();
  return () => {
    observer.disconnect();
    reduced.removeEventListener("change", sync);
    mono.destroy();
  };
}
