"use client";

/* The editor needs the element's natural dimensions and pointer positioning. */

import { useEffect, useRef, useState } from "react";
import type { TextOverlay } from "@/engine/types";

export function CanvasStage({ src, videoSrc, alt, overlays, activeId, time, mediaTime, playing = false, loopStart, loopEnd, onTime, onSelect, onMove, onMoveStart, onMoveEnd }: {
  src: string;
  videoSrc?: string;
  alt: string;
  overlays: TextOverlay[];
  activeId: string | null;
  time?: number;
  mediaTime?: number;
  playing?: boolean;
  loopStart?: number;
  loopEnd?: number;
  onTime?: (time: number) => void;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onMoveStart?: () => void;
  onMoveEnd?: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    const element = video.current;
    const requestedTime = mediaTime ?? time;
    if (!element || requestedTime === undefined) return;
    const outsideLoop = playing && loopStart !== undefined && loopEnd !== undefined
      && (element.currentTime < loopStart || element.currentTime >= loopEnd);
    if ((!playing || outsideLoop) && Math.abs(element.currentTime - requestedTime) > .03) element.currentTime = requestedTime;
  }, [loopEnd, loopStart, mediaTime, playing, time, videoSrc]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (playing) void element.play().catch(() => undefined);
    else element.pause();
  }, [playing, videoSrc]);

  useEffect(() => {
    const element = video.current;
    if (!element || !playing) return;
    let frame = 0;
    let lastReportedAt = 0;
    const update = () => {
      if (loopEnd !== undefined && element.currentTime >= loopEnd) element.currentTime = loopStart ?? 0;
      const now = performance.now();
      if (now - lastReportedAt >= 100) {
        lastReportedAt = now;
        onTime?.(element.currentTime);
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [loopEnd, loopStart, onTime, playing, videoSrc]);

  function move(event: React.PointerEvent<HTMLElement>, id: string) {
    const bounds = stage.current?.getBoundingClientRect();
    if (!bounds) return;
    onMoveStart?.();
    event.currentTarget.setPointerCapture(event.pointerId);
    const update = (clientX: number, clientY: number) => onMove(
      id,
      Math.max(4, Math.min(96, ((clientX - bounds.left) / bounds.width) * 100)),
      Math.max(5, Math.min(95, ((clientY - bounds.top) / bounds.height) * 100)),
    );
    update(event.clientX, event.clientY);
    const target = event.currentTarget as HTMLElement;
    target.onpointermove = (next) => update(next.clientX, next.clientY);
    target.onpointerup = () => { target.onpointermove = null; target.onpointerup = null; onMoveEnd?.(); };
  }

  return (
    <div className="canvas-stage" ref={stage} style={ratio ? { aspectRatio: ratio } : undefined}>
      {videoSrc
        ? <video ref={video} src={videoSrc} aria-label={alt} muted playsInline preload="metadata" onLoadedMetadata={(event) => {
            setRatio(event.currentTarget.videoWidth / event.currentTarget.videoHeight);
            const requestedTime = mediaTime ?? time;
            if (requestedTime !== undefined) event.currentTarget.currentTime = requestedTime;
          }} />
        : <img src={src} alt={alt} draggable={false} onLoad={(event) => setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} />}
      {overlays.filter((item) => time === undefined || ((item.start ?? 0) <= time && (item.end ?? Infinity) >= time)).map((overlay) => (
        <button
          className={overlay.id === activeId ? "canvas-overlay active" : "canvas-overlay"}
          style={{ left: `${overlay.x}%`, top: `${overlay.y}%`, color: overlay.color, fontSize: `${overlay.fontSize}px`, textAlign: overlay.align }}
          type="button"
          key={overlay.id}
          onPointerDown={(event) => { onSelect(overlay.id); move(event, overlay.id); }}
          aria-label={`Move text: ${overlay.text}`}
        >{overlay.text}</button>
      ))}
    </div>
  );
}
