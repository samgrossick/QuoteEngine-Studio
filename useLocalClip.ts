import { useEffect, useState } from "react";
import type { LocalSource, ProxyClip } from "@/engine/local/source";

type ClipResult = { key: string; clip: ProxyClip | null; error: string | null };

/**
 * Keeps a playable clip covering the requested window.
 *
 * On the native path this resolves immediately to the file itself. On the
 * FFmpeg path it transcodes a small window once, so that scrubbing, previewing
 * and exporting afterwards are ordinary `<video>` seeks rather than a fresh
 * pass over a multi-gigabyte file for every frame.
 *
 * Results are keyed by the window they belong to and compared during render.
 * That way a window the viewer has already moved past can never resolve into
 * the interface, and nothing has to be cleared synchronously in the effect.
 */
export function useLocalClip(source: LocalSource | null, start: number, end: number, width: number, enabled = true) {
  const [result, setResult] = useState<ClipResult | null>(null);
  const [progress, setProgress] = useState<{ key: string; value: number }>({ key: "", value: 0 });

  // Whole seconds, so nudging the playhead does not request a new transcode.
  const from = Math.max(0, Math.floor(start));
  const to = Math.ceil(end);
  const key = `${from}-${to}-${width}`;

  useEffect(() => {
    // Transcoding is expensive on the FFmpeg path, so callers hold this back
    // until the viewer actually asks for motion.
    if (!source || !enabled) return;
    let cancelled = false;
    source.proxy(from, to, width, (value) => { if (!cancelled) setProgress({ key, value }); })
      .then((clip) => { if (!cancelled) setResult({ key, clip, error: null }); })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setResult({
          key,
          clip: null,
          error: reason instanceof Error ? reason.message : "This part of the video could not be prepared.",
        });
      });
    return () => { cancelled = true; };
  }, [enabled, key, source, from, to, width]);

  const current = result?.key === key ? result : null;
  return {
    clip: current?.clip ?? null,
    preparing: enabled && source !== null && current === null,
    progress: progress.key === key ? progress.value : 0,
    error: current?.error ?? null,
  };
}
