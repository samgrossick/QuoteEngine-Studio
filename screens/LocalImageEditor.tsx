import { useEffect, useMemo, useState } from "react";
import { CanvasStage } from "@/components/CanvasStage";
import { canvasBlob, downloadBlob, renderStill } from "@/engine/canvas-render";
import { editorId } from "@/engine/editor-id";
import { captionTime, formatTime } from "@/engine/media";
import { useHistoryState } from "@/hooks/useHistoryState";
import type { LocalSource } from "@/engine/local/source";
import type { SearchEpisode, TextOverlay } from "@/engine/types";

function overlay(text: string): TextOverlay {
  return { id: editorId("text"), text, x: 50, y: 82, fontSize: 38, color: "#ffffff", align: "center" };
}

export function LocalImageEditor({ source, episode, time, onTime, onBack }: {
  source: LocalSource;
  episode: SearchEpisode;
  time: number;
  onTime: (time: number) => void;
  onBack: () => void;
}) {
  // Keyed by the moment it was decoded from, so a slow decode for a frame the
  // viewer has already stepped past can never overwrite the current one.
  const [decoded, setDecoded] = useState<{ time: number; url: string | null; error: string | null } | null>(null);
  const [status, setStatus] = useState("");
  const history = useHistoryState<TextOverlay[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = history.value.find((item) => item.id === activeId) ?? null;
  const current = Math.max(0, Math.min(source.duration, time));

  // Full source width, because this frame is the thing being exported.
  useEffect(() => {
    let cancelled = false;
    source.frame(current, source.width)
      .then((url) => { if (!cancelled) setDecoded({ time: current, url, error: null }); })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setDecoded({
          time: current,
          url: null,
          error: reason instanceof Error ? reason.message : "That frame could not be decoded.",
        });
      });
    return () => { cancelled = true; };
  }, [current, source]);

  const ready = decoded?.time === current ? decoded : null;
  const frame = ready?.url ?? null;
  const error = ready?.error ?? null;

  const nearestLine = useMemo(() => {
    if (episode.captions.length === 0) return "";
    return episode.captions.reduce((best, caption) =>
      Math.abs(captionTime(caption) - current) < Math.abs(captionTime(best) - current) ? caption : best).text;
  }, [current, episode.captions]);

  function update(id: string, changes: Partial<TextOverlay>, transient = false) {
    const change = (items: TextOverlay[]) => items.map((item) => item.id === id ? { ...item, ...changes } : item);
    if (transient) history.preview(change);
    else history.commit(change);
  }

  async function save(type: "image/png" | "image/jpeg") {
    if (!frame) return;
    setStatus("Rendering…");
    try {
      const canvas = await renderStill(frame, history.value);
      downloadBlob(await canvasBlob(canvas, type, 0.93), `${episode.title}-${Math.round(current)}.${type === "image/png" ? "png" : "jpg"}`);
      setStatus("Downloaded.");
    } catch (reason: unknown) {
      setStatus(reason instanceof Error ? reason.message : "Export failed.");
    }
  }

  async function copy() {
    if (!frame) return;
    setStatus("Rendering…");
    try {
      const blob = await canvasBlob(await renderStill(frame, history.value));
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setStatus("Copied to the clipboard.");
    } catch (reason: unknown) {
      setStatus(reason instanceof Error ? reason.message : "This browser would not allow a copy.");
    }
  }

  return (
    <section className="editor-layout">
      <section className="editor-preview-panel">
        {error ? <div className="empty-state"><strong>Frame unavailable.</strong><p>{error}</p></div>
          : frame ? <CanvasStage
              src={frame}
              alt={`Frame at ${formatTime(current)}`}
              overlays={history.value}
              activeId={activeId}
              onSelect={setActiveId}
              onMoveStart={history.begin}
              onMove={(id, x, y) => update(id, { x, y }, true)}
              onMoveEnd={history.end}
            />
          : <div className="page-loading">Decoding the frame…</div>}
        <div className="frame-stepper">
          <button type="button" onClick={() => onTime(Math.max(0, current - 1))}>← Previous</button>
          <strong>{formatTime(current)}</strong>
          <button type="button" onClick={() => onTime(Math.min(source.duration, current + 1))}>Next →</button>
        </div>
      </section>

      <aside className="editor-controls">
        <div className="control-toolbar">
          <button disabled={!history.canUndo} onClick={history.undo}>Undo</button>
          <button disabled={!history.canRedo} onClick={history.redo}>Redo</button>
          <button onClick={() => { history.reset([]); setActiveId(null); }}>Clear</button>
        </div>
        {/* Only offered when there is a line to pull in. */}
        {episode.captions.length > 0 && <button
          className="primary-action wide-action"
          onClick={() => { const item = overlay(nearestLine || "New caption"); history.commit((items) => [...items, item]); setActiveId(item.id); }}
        >+ Add the nearest line</button>}
        <button
          className={episode.captions.length ? "secondary-action wide-action" : "primary-action wide-action"}
          onClick={() => { const item = overlay("New caption"); history.commit((items) => [...items, item]); setActiveId(item.id); }}
        >+ Add a caption</button>
        {active ? <div className="control-group">
          <label>Text<textarea rows={4} value={active.text} onChange={(event) => update(active.id, { text: event.target.value })} /></label>
          <label>Size<input type="range" min="18" max="72" value={active.fontSize} onPointerDown={history.begin} onChange={(event) => update(active.id, { fontSize: Number(event.target.value) }, true)} onPointerUp={history.end} /></label>
          <label>Colour<input type="color" value={active.color} onChange={(event) => update(active.id, { color: event.target.value })} /></label>
          <label>Alignment<select value={active.align} onChange={(event) => update(active.id, { align: event.target.value as TextOverlay["align"] })}><option>left</option><option>center</option><option>right</option></select></label>
          <button className="danger-button" onClick={() => { history.commit((items) => items.filter((item) => item.id !== active.id)); setActiveId(null); }}>Delete selected text</button>
        </div> : <p className="control-help">Add or select text, then drag it directly on the image.</p>}
        <div className="export-grid">
          <button onClick={() => void save("image/png")} disabled={!frame}>Download PNG</button>
          <button onClick={() => void save("image/jpeg")} disabled={!frame}>Download JPEG</button>
          <button onClick={() => void copy()} disabled={!frame}>Copy image</button>
        </div>
        <p className="export-status" aria-live="polite">{status || "Everything is rendered in this tab; nothing is uploaded."}</p>
        <button className="secondary-action wide-action" type="button" onClick={onBack}>Back to the scene</button>
      </aside>
    </section>
  );
}
