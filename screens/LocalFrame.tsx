/* These are blob URLs decoded in the page, not remote assets. */

import { useEffect, useRef, useState } from "react";
import type { LocalSource } from "@/engine/local/source";

/** How far outside the viewport a frame starts decoding. */
const LAZY_MARGIN = 300;

/**
 * A still from the opened file.
 *
 * Decoding is deferred until the frame is close to the viewport. On the native
 * path a seek is cheap, but on the FFmpeg path every thumbnail costs a pass
 * over the file, so a grid of results that all decoded at once would stall the
 * engine for a minute on work nobody has scrolled to yet.
 */
export function LocalFrame({ source, time, width = 320, alt, eager = false, className }: {
  source: LocalSource;
  time: number;
  width?: number;
  alt: string;
  eager?: boolean;
  className?: string;
}) {
  // One keyed result rather than separate url/failed state, so a request that
  // is already in flight when the time changes cannot show the wrong frame,
  // and nothing has to be reset synchronously inside the effect.
  const [result, setResult] = useState<{ key: string; url: string | null } | null>(null);
  const [visible, setVisible] = useState(eager);
  const holder = useRef<HTMLDivElement>(null);
  const key = `${width}@${time}`;

  useEffect(() => {
    if (visible) return;
    const element = holder.current;
    if (!element) return;
    // Measured synchronously first. IntersectionObserver only reports while the
    // page is compositing, so a background tab or an embedded view that never
    // paints would leave a frame that is plainly on screen blank forever.
    const rect = element.getBoundingClientRect();
    const onScreen = rect.bottom > -LAZY_MARGIN && rect.top < window.innerHeight + LAZY_MARGIN;
    if (onScreen || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: `${LAZY_MARGIN}px` });
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    source.frame(time, width)
      .then((url) => { if (!cancelled) setResult({ key, url }); })
      .catch(() => { if (!cancelled) setResult({ key, url: null }); });
    return () => { cancelled = true; };
  }, [key, source, time, width, visible]);

  const current = result?.key === key ? result : null;

  return (
    <div className={className ? `local-frame ${className}` : "local-frame"} ref={holder}>
      {current?.url && <img src={current.url} alt={alt} draggable={false} />}
      {!current?.url && <span className="local-frame-placeholder">{current ? "No frame" : ""}</span>}
    </div>
  );
}
