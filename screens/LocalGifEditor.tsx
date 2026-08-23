import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasStage } from "@/components/CanvasStage";
import { LocalFrame } from "./LocalFrame";
import { downloadBlob, paintFrame } from "@/engine/canvas-render";
import { editorId } from "@/engine/editor-id";
import { encodeGif } from "@/engine/gif-encoder";
import { loadedVideo, seekVideo } from "@/engine/local/frames";
import { captionTime, formatTime } from "@/engine/media";
import { recordCanvas } from "@/engine/video-export";
import { useHistoryState } from "@/hooks/useHistoryState";
import { useLocalClip } from "../useLocalClip";
import type { LocalSource } from "@/engine/local/source";
import type { StudioConfig } from "../config";
import type { SearchEpisode, TextOverlay } from "@/engine/types";

type TimelineDrag = "start" | "end" | "playhead";
type OverlayDrag = "move" | "start" | "end";

const WINDOW_LENGTH = 12;

export function LocalGifEditor({ source, episode, config, time, onBack }: {
  source: LocalSource;
  episode: SearchEpisode;
  config: StudioConfig;
  time: number;
  onBack: () => void;
}) {
  const maxLength = config.media.maxGifSeconds;
  const fps = config.media.motionFps;
  const anchor = Math.max(0, time - 2);
  const [start, setStart] = useState(anchor);
  const [end, setEnd] = useState(Math.min(source.duration, anchor + Math.min(5, maxLength)));
  const [playhead, setPlayhead] = useState(anchor);
  const [windowStart, setWindowStart] = useState(Math.max(0, time - 5));
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const history = useHistoryState<TextOverlay[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const active = history.value.find((item) => item.id === activeId) ?? null;

  const windowEnd = Math.min(source.duration, windowStart + WINDOW_LENGTH);
  const visibleDuration = Math.max(0.2, windowEnd - windowStart);
  const { clip, preparing, progress: clipProgress, error: clipError } = useLocalClip(
    source, windowStart, windowEnd, config.media.motionWidth,
  );

  const transcriptCaptions = useMemo(() => episode.captions.filter((caption) => {
    const at = captionTime(caption);
    return at >= start && at <= end;
  }), [end, episode.captions, start]);
  const transcript = transcriptCaptions.map((caption) => caption.text).join(" ");
  const filmstrip = useMemo(
    () => Array.from({ length: Math.ceil(visibleDuration) + 1 }, (_, index) => Math.min(windowEnd, windowStart + index)),
    [visibleDuration, windowEnd, windowStart],
  );
  const percent = (at: number) => Math.max(0, Math.min(100, (at - windowStart) / visibleDuration * 100));

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
      if (event.code === "Space") { event.preventDefault(); setPlaying((value) => !value); }
      if (event.key === "ArrowLeft") { event.preventDefault(); setPlaying(false); setPlayhead((at) => Math.max(start, at - 1 / fps)); }
      if (event.key === "ArrowRight") { event.preventDefault(); setPlaying(false); setPlayhead((at) => Math.min(end, at + 1 / fps)); }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [end, fps, start]);

  function updateOverlay(id: string, changes: Partial<TextOverlay>, transient = false) {
    const change = (items: TextOverlay[]) => items.map((item) => item.id === id ? { ...item, ...changes } : item);
    if (transient) history.preview(change);
    else history.commit(change);
  }

  function timeAt(clientX: number) {
    const bounds = timeline.current?.getBoundingClientRect();
    if (!bounds) return windowStart;
    return windowStart + Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)) * visibleDuration;
  }

  function dragTimeline(kind: TimelineDrag, event: React.PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const apply = (clientX: number) => {
      const at = timeAt(clientX);
      if (kind === "start") {
        const next = Math.max(Math.max(windowStart, end - maxLength), Math.min(at, end - 0.2));
        setStart(next);
        setPlayhead((current) => Math.max(next, current));
      } else if (kind === "end") {
        const next = Math.min(windowEnd, Math.max(at, start + 0.2), start + maxLength);
        setEnd(next);
        setPlayhead((current) => Math.min(next, current));
      } else {
        setPlaying(false);
        setPlayhead(Math.max(start, Math.min(end, at)));
      }
    };
    apply(event.clientX);
    const target = event.currentTarget;
    target.onpointermove = (next) => apply(next.clientX);
    target.onpointerup = () => { target.onpointermove = null; target.onpointerup = null; };
  }

  function dragOverlayTrack(id: string, mode: OverlayDrag, event: React.PointerEvent<HTMLElement>) {
    const bounds = event.currentTarget.closest(".overlay-track-rail")?.getBoundingClientRect();
    const item = history.value.find((overlay) => overlay.id === id);
    if (!bounds || !item) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    history.begin();
    const duration = end - start;
    const originalStart = item.start ?? 0;
    const originalEnd = item.end ?? duration;
    const originX = event.clientX;
    const apply = (clientX: number) => {
      const delta = (clientX - originX) / bounds.width * duration;
      if (mode === "start") updateOverlay(id, { start: Math.max(0, Math.min(originalEnd - 0.1, originalStart + delta)) }, true);
      else if (mode === "end") updateOverlay(id, { end: Math.min(duration, Math.max(originalStart + 0.1, originalEnd + delta)) }, true);
      else {
        const width = originalEnd - originalStart;
        const nextStart = Math.max(0, Math.min(duration - width, originalStart + delta));
        updateOverlay(id, { start: nextStart, end: nextStart + width }, true);
      }
    };
    const target = event.currentTarget;
    target.onpointermove = (next) => apply(next.clientX);
    target.onpointerup = () => { target.onpointermove = null; target.onpointerup = null; history.end(); };
  }

  function addText() {
    const item: TextOverlay = {
      id: editorId("caption"),
      text: transcript || "New caption",
      x: 50, y: 82, fontSize: 34, color: "#ffffff", align: "center",
      start: 0, end: end - start,
    };
    history.commit((items) => [...items, item]);
    setActiveId(item.id);
  }

  function addSubtitleTracks() {
    const tracks = transcriptCaptions.map((caption, index): TextOverlay => ({
      id: editorId(`subtitle-${index}`),
      text: caption.text,
      x: 50, y: 82, fontSize: 34, color: "#ffffff", align: "center",
      start: Math.max(0, caption.startMs / 1000 - start),
      end: Math.min(end - start, caption.endMs / 1000 - start),
    })).filter((item) => (item.end ?? 0) > (item.start ?? 0));
    history.commit((items) => [...items, ...tracks]);
    setActiveId(tracks[0]?.id ?? null);
  }

  /** Paints every frame of the trim range, captions included, ready to encode. */
  async function prepareFrames() {
    if (!clip) throw new Error("This part of the video is still being prepared.");
    const count = Math.max(1, Math.round((end - start) * fps));
    const canvas = document.createElement("canvas");
    canvas.width = config.media.motionWidth;
    canvas.height = Math.max(2, Math.round(canvas.width * source.height / source.width / 2) * 2);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas is unavailable.");
    const video = await loadedVideo(clip.url);
    const data: ImageData[] = [];
    for (let index = 0; index < count; index += 1) {
      const at = start + index / fps;
      setProgressText(`Preparing frame ${index + 1} of ${count}…`);
      setProgress((index + 1) / (count + 1));
      await seekVideo(video, at - clip.offset);
      paintFrame(context, video, canvas.width, canvas.height, history.value, at - start);
      data.push(context.getImageData(0, 0, canvas.width, canvas.height));
      // Yield now and then so the progress text actually repaints.
      if (index % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    video.removeAttribute("src");
    video.load();
    return { canvas, data, draws: data.map((frame) => () => context.putImageData(frame, 0, 0)) };
  }

  async function saveGif() {
    setPlaying(false);
    setProgress(0);
    try {
      const { data } = await prepareFrames();
      setProgressText("Encoding GIF…");
      setProgress(0.96);
      downloadBlob(encodeGif(data, Math.round(100 / fps)), `${episode.title}-${Math.floor(start)}.gif`);
      setProgressText("GIF downloaded.");
      setProgress(1);
    } catch (reason: unknown) {
      setProgressText(reason instanceof Error ? reason.message : "Export failed.");
      setProgress(0);
    }
  }

  async function saveVideo() {
    setPlaying(false);
    setProgress(0);
    try {
      const { canvas, draws } = await prepareFrames();
      setProgressText("Recording video…");
      setProgress(0.75);
      const format = await recordCanvas(canvas, draws, fps, `${episode.title}-${Math.floor(start)}`);
      setProgressText(`${format.toUpperCase()} downloaded.`);
      setProgress(1);
    } catch (reason: unknown) {
      setProgressText(reason instanceof Error ? reason.message : "Export failed.");
      setProgress(0);
    }
  }

  return (
    <section className="editor-layout gif-editor-layout">
      <section className="editor-preview-panel">
        {clipError
          ? <div className="empty-state"><strong>This clip could not be prepared.</strong><p>{clipError}</p></div>
          : clip
            ? <CanvasStage
                src=""
                videoSrc={clip.url}
                alt={`Clip from ${episode.title}`}
                overlays={history.value}
                activeId={activeId}
                time={playhead - start}
                mediaTime={playhead - clip.offset}
                playing={playing}
                loopStart={start - clip.offset}
                loopEnd={end - clip.offset}
                onTime={(at) => setPlayhead(at + clip.offset)}
                onSelect={setActiveId}
                onMoveStart={history.begin}
                onMove={(id, x, y) => updateOverlay(id, { x, y }, true)}
                onMoveEnd={history.end}
              />
            : <div className="page-loading">
                {source.kind === "ffmpeg"
                  ? `Transcoding a ${Math.round(visibleDuration)}-second working copy… ${Math.round(clipProgress * 100)}%`
                  : "Preparing the clip…"}
              </div>}

        <section className="gif-timeline-panel" aria-label="Clip timeline">
          <div className="timeline-toolbar">
            <button type="button" onClick={() => setWindowStart((value) => Math.max(0, value - 6))}>← Earlier</button>
            <button className="timeline-play" type="button" onClick={() => setPlaying((value) => !value)} disabled={!clip}>
              {playing ? "Pause" : "Play"}
            </button>
            <button type="button" onClick={() => setWindowStart((value) => Math.min(Math.max(0, source.duration - WINDOW_LENGTH), value + 6))}>Later →</button>
          </div>
          <div className="timeline-filmstrip" ref={timeline}>
            {filmstrip.map((at) => <LocalFrame source={source} time={at} width={120} alt="" key={at} className="timeline-thumbnail" />)}
            <span className="timeline-shade before" style={{ width: `${percent(start)}%` }} />
            <span className="timeline-shade after" style={{ left: `${percent(end)}%` }} />
            <span className="timeline-selection" style={{ left: `${percent(start)}%`, width: `${percent(end) - percent(start)}%` }} />
            <button className="trim-handle trim-start" type="button" style={{ left: `${percent(start)}%` }} onPointerDown={(event) => dragTimeline("start", event)} aria-label="Drag clip start">{formatTime(start)}</button>
            <button className="trim-handle trim-end" type="button" style={{ left: `${percent(end)}%` }} onPointerDown={(event) => dragTimeline("end", event)} aria-label="Drag clip end">{formatTime(end)}</button>
            <button className="timeline-playhead" type="button" style={{ left: `${percent(playhead)}%` }} onPointerDown={(event) => dragTimeline("playhead", event)} aria-label={`Playhead at ${formatTime(playhead)}`} />
          </div>
          <div className="overlay-tracks">
            {history.value.map((overlay) => {
              const duration = end - start;
              const from = Math.max(0, overlay.start ?? 0);
              const to = Math.min(duration, overlay.end ?? duration);
              return (
                <div className={overlay.id === activeId ? "overlay-track active" : "overlay-track"} key={overlay.id}>
                  <span>{overlay.text}</span>
                  <div className="overlay-track-rail">
                    <button
                      className="overlay-track-bar"
                      type="button"
                      style={{ left: `${from / duration * 100}%`, width: `${Math.max(0.1, to - from) / duration * 100}%` }}
                      onClick={() => setActiveId(overlay.id)}
                      onPointerDown={(event) => dragOverlayTrack(overlay.id, "move", event)}
                    >
                      <i className="track-grip start" onPointerDown={(event) => { event.stopPropagation(); dragOverlayTrack(overlay.id, "start", event); }} />
                      <i className="track-grip end" onPointerDown={(event) => { event.stopPropagation(); dragOverlayTrack(overlay.id, "end", event); }} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="keyboard-tip">Space plays or pauses · ← → moves one frame · drag the yellow handles to trim</p>
        </section>
      </section>

      <aside className="editor-controls">
        <div className="control-toolbar">
          <button disabled={!history.canUndo} onClick={history.undo}>Undo</button>
          <button disabled={!history.canRedo} onClick={history.redo}>Redo</button>
          <button onClick={() => history.reset([])}>Clear</button>
        </div>
        <button className="primary-action wide-action" onClick={addSubtitleTracks} disabled={!transcriptCaptions.length}>+ Subtitle tracks</button>
        <button className="secondary-action wide-action" onClick={addText}>+ Single text track</button>
        {active && <div className="control-group">
          <label>Text<textarea rows={4} value={active.text} onChange={(event) => updateOverlay(active.id, { text: event.target.value })} /></label>
          <label>Size<input type="range" min="18" max="64" value={active.fontSize} onPointerDown={history.begin} onChange={(event) => updateOverlay(active.id, { fontSize: Number(event.target.value) }, true)} onPointerUp={history.end} /></label>
          <label>Colour<input type="color" value={active.color} onChange={(event) => updateOverlay(active.id, { color: event.target.value })} /></label>
          <label>Alignment<select value={active.align} onChange={(event) => updateOverlay(active.id, { align: event.target.value as TextOverlay["align"] })}><option>left</option><option>center</option><option>right</option></select></label>
          <div className="inline-controls">
            <label>From<input type="number" min="0" max={end - start} step=".1" value={active.start ?? 0} onChange={(event) => updateOverlay(active.id, { start: Number(event.target.value) })} /></label>
            <label>To<input type="number" min="0" max={end - start} step=".1" value={active.end ?? end - start} onChange={(event) => updateOverlay(active.id, { end: Number(event.target.value) })} /></label>
          </div>
          <button className="danger-button" onClick={() => { history.commit((items) => items.filter((item) => item.id !== active.id)); setActiveId(null); }}>Delete selected text</button>
        </div>}
        <div className="export-grid">
          <button onClick={() => void saveGif()} disabled={!clip || preparing}>Download GIF</button>
          <button onClick={() => void saveVideo()} disabled={!clip || preparing}>Download video</button>
        </div>
        <progress className="export-progress" max="1" value={progress} aria-label="Export progress" />
        <p className="export-status" aria-live="polite">{progressText || "Everything is rendered in this tab; nothing is uploaded."}</p>
        <button className="secondary-action wide-action" type="button" onClick={onBack}>Back to the scene</button>
      </aside>
    </section>
  );
}
