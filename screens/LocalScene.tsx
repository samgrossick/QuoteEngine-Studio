import { useEffect, useRef, useState } from "react";
import { LocalFrame } from "./LocalFrame";
import { downloadBlob } from "@/engine/canvas-render";
import { captionTime, formatTime } from "@/engine/media";
import { useLocalClip } from "../useLocalClip";
import type { LocalSource } from "@/engine/local/source";
import type { StudioConfig } from "../config";
import type { SearchEpisode } from "@/engine/types";
import type { LocalView } from "./LocalWorkspace";

const PREVIEW_SECONDS = 5;

export function LocalScene({ source, episode, config, time, onTime, onOpen, onAddSubtitles }: {
  source: LocalSource;
  episode: SearchEpisode;
  config: StudioConfig;
  time: number;
  onTime: (time: number) => void;
  onOpen: (view: LocalView, time: number) => void;
  onAddSubtitles: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const transcriptPanel = useRef<HTMLElement>(null);
  const activeLine = useRef<HTMLButtonElement>(null);

  const current = Math.max(0, Math.min(source.duration, time));
  // Only transcoded once the viewer asks for motion; on the FFmpeg path this
  // is a real wait, and most visits never press play.
  const { clip, preparing, progress } = useLocalClip(
    source,
    Math.max(0, current - 1),
    Math.min(source.duration, current + PREVIEW_SECONDS + 1),
    config.media.motionWidth,
    playing,
  );

  const currentCaption = episode.captions.find((caption) => caption.startMs <= current * 1000 && caption.endMs >= current * 1000) ?? null;
  const selectedCaption = episode.captions.length
    ? episode.captions.reduce((best, caption) =>
        Math.abs(captionTime(caption) - current) < Math.abs(captionTime(best) - current) ? caption : best)
    : null;
  const transcript = episode.captions.filter((caption) =>
    caption.endMs >= (current - 30) * 1000 && caption.startMs <= (current + 30) * 1000);
  const filmstrip = Array.from({ length: 17 }, (_, index) =>
    Math.max(0, Math.min(Math.floor(source.duration), Math.floor(current) - 8 + index)))
    .filter((value, index, all) => all.indexOf(value) === index);

  useEffect(() => {
    const panel = transcriptPanel.current;
    const line = activeLine.current;
    if (!panel || !line) return;
    const panelRect = panel.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    panel.scrollTo({
      top: Math.max(0, panel.scrollTop + lineRect.top - panelRect.top - (panel.clientHeight - lineRect.height) / 2),
      behavior: "smooth",
    });
  }, [currentCaption?.id, selectedCaption?.id]);

  useEffect(() => {
    const element = video.current;
    if (!playing || !clip || !element) return;
    let frame = 0;
    const stopAt = current + PREVIEW_SECONDS;
    element.currentTime = Math.max(0, current - clip.offset);
    void element.play().catch(() => setPlaying(false));
    const watch = () => {
      const at = element.currentTime + clip.offset;
      if (at >= stopAt || element.ended) { setPlaying(false); onTime(Math.min(source.duration, stopAt)); return; }
      frame = requestAnimationFrame(watch);
    };
    frame = requestAnimationFrame(watch);
    return () => { cancelAnimationFrame(frame); element.pause(); };
  }, [clip, current, onTime, playing, source.duration]);

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); setPlaying(false); onTime(Math.max(0, current - 1)); }
      if (event.key === "ArrowRight") { event.preventDefault(); setPlaying(false); onTime(Math.min(source.duration, current + 1)); }
      if (event.code === "Space") { event.preventDefault(); setPlaying((value) => !value); }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [current, onTime, source.duration]);

  async function saveFrame() {
    setSaving(true);
    setError(null);
    try {
      const url = await source.frame(current, source.width);
      const blob = await (await fetch(url)).blob();
      downloadBlob(blob, `${episode.title}-${Math.round(current)}.jpg`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "That frame could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function choose(next: number) {
    setPlaying(false);
    onTime(Math.max(0, Math.min(source.duration, next)));
  }

  return (
    <section className="studio-layout">
      <div className="studio-main">
        <div className="motion-stage">
          {playing && clip
            ? <video ref={video} src={clip.url} muted playsInline aria-label={`Preview at ${formatTime(current)}`} />
            : <LocalFrame source={source} time={current} width={960} alt={`Frame at ${formatTime(current)}`} eager />}
          <button className="preview-play" type="button" onClick={() => setPlaying((value) => !value)} disabled={preparing}>
            {playing ? "Pause" : preparing ? `Preparing… ${Math.round(progress * 100)}%` : `Play ${PREVIEW_SECONDS}-second preview`}
          </button>
          <button className="frame-arrow previous" type="button" aria-label="Previous second" onClick={() => choose(current - 1)} disabled={current <= 0}>←</button>
          <button className="frame-arrow next" type="button" aria-label="Next second" onClick={() => choose(current + 1)} disabled={current >= source.duration}>→</button>
        </div>

        <div className="filmstrip" role="list" aria-label="Nearby frames">
          {filmstrip.map((at) => (
            <button
              className={Math.floor(at) === Math.floor(current) ? "filmstrip-frame active" : "filmstrip-frame"}
              type="button"
              onClick={() => choose(at)}
              key={at}
              aria-label={`Select ${formatTime(at)}`}
            >
              <LocalFrame source={source} time={at} width={160} alt="" />
              <span>{formatTime(at)}</span>
            </button>
          ))}
        </div>

        <label className="scene-scrubber">
          <span>Drag through the whole file</span>
          <input type="range" min="0" max={source.duration} step=".2" value={current} onChange={(event) => choose(Number(event.target.value))} />
          <strong>{formatTime(current)} / {formatTime(source.duration)}</strong>
        </label>

        <div className="scene-actions mobile-action-bar">
          <button className="primary-action" type="button" onClick={() => onOpen("image", current)}>Make image</button>
          <button className="primary-action accent-action" type="button" onClick={() => onOpen("gif", current)}>Make GIF</button>
          <button className="secondary-action dark-secondary" type="button" onClick={() => void saveFrame()} disabled={saving}>
            {saving ? "Saving…" : "Save frame"}
          </button>
        </div>
        {error && <p className="local-error" role="alert">{error}</p>}
        <p className="keyboard-tip">Keyboard: ← → change frame · Space plays or pauses</p>
      </div>

      <aside ref={transcriptPanel} className="scene-transcript">
        <div className="transcript-header">
          <span>{episode.captions.length ? "Dialogue · ±30 seconds" : "No subtitles"}</span>
          <span>{selectedCaption?.timestamp.slice(3)}</span>
        </div>
        <div className="transcript-list">
          {episode.captions.length === 0 ? (
            <div className="transcript-empty">
              <p>Scrub to the moment you want, then write your own caption in the image or GIF editor.</p>
              <button className="secondary-action" type="button" onClick={onAddSubtitles}>Add subtitles</button>
            </div>
          ) : transcript.length === 0 ? (
            <p className="control-help">No dialogue near this moment.</p>
          ) : null}
          {transcript.map((caption) => {
            const active = caption.id === (currentCaption?.id ?? selectedCaption?.id);
            return (
              <button
                key={caption.id}
                ref={active ? activeLine : undefined}
                className={active ? "transcript-line active" : "transcript-line"}
                type="button"
                onClick={() => choose(captionTime(caption))}
              >
                <span>{caption.timestamp.slice(3)}</span><strong>{caption.text}</strong>
              </button>
            );
          })}
        </div>
      </aside>
    </section>
  );
}
