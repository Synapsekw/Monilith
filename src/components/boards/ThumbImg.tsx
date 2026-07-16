"use client";

import { useState } from "react";

/**
 * A thumbnail `<img>` that prefers a Supabase image-transform URL (`thumbUrl`)
 * and falls back to the full-resolution signed URL (`fullUrl`) **once** on
 * error. Supabase image transforms are a Pro-plan feature: signing the
 * `/render/image` URL always succeeds, but the fetch 4xxs when the flag is off,
 * which `onError` catches. Renders `thumbUrl ?? fullUrl` initially; `loading`
 * defaults to lazy so offscreen chips/cards don't fetch until scrolled in.
 */
export function ThumbImg({
  thumbUrl,
  fullUrl,
  alt,
  className,
}: {
  thumbUrl?: string;
  fullUrl?: string;
  alt: string;
  className?: string;
}) {
  const initial = thumbUrl ?? fullUrl;
  const [src, setSrc] = useState(initial);
  // Reset during render (not in an effect — react-hooks/set-state-in-effect)
  // when the resolved URL changes, e.g. a re-mint after the short TTL expires.
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setSrc(initial);
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={className}
      onError={() => {
        // One-shot fallback: if the transform URL failed, swap to full-res.
        if (fullUrl && src !== fullUrl) setSrc(fullUrl);
      }}
    />
  );
}
