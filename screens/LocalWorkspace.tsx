import { useEffect, useMemo, useState } from "react";
import { localCaptions, localProgramme, localSearchEpisode } from "@/engine/local/catalog";
import { formatTime } from "@/engine/media";
import { normalizeSearchText } from "@/engine/search";
import type { LocalSource } from "@/engine/local/source";
import type { StudioConfig } from "../config";
import { useSubtitles } from "../useSubtitles";
import { LocalGifEditor } from "./LocalGifEditor";
import { LocalImageEditor } from "./LocalImageEditor";
import { LocalOpener } from "./LocalOpener";
import { LocalScene } from "./LocalScene";
import { LocalSearch } from "./LocalSearch";

export type LocalView = "search" | "scene" | "image" | "gif";

/**
 * Everything that happens once a file is open.
 *
 * The opened file and its subtitles are owned here rather than by the opener,
 * so that going back to change either of them keeps the playhead, and so that
 * there is exactly one thing responsible for releasing the source.
 *
 * Views are state rather than routes. The file lives only in this tab's
 * memory, so a URL that could be reloaded or shared would land on an empty
 * studio and make the visitor pick the file again.
 */
export function LocalWorkspace({ config }: { config: StudioConfig }) {
  const [source, setSource] = useState<LocalSource | null>(null);
  const [entered, setEntered] = useState(false);
  const [view, setView] = useState<LocalView>("scene");
  const [time, setTime] = useState(0);
  const subtitles = useSubtitles();

  // Releases blob URLs, the frame cache and the mounted file when the source is
  // replaced or the tab moves on.
  useEffect(() => () => source?.release(), [source]);

  const captions = useMemo(
    () => localCaptions(subtitles.cues, (value) => normalizeSearchText(value, config.locale)),
    [config.locale, subtitles.cues],
  );
  const episode = useMemo(() => {
    if (!source) return null;
    return localSearchEpisode(localProgramme(source.file.name, source.duration, source.width, source.height, captions));
  }, [captions, source]);

  function enter() {
    setView(captions.length ? "search" : "scene");
    setEntered(true);
  }

  function goTo(next: LocalView, at: number) {
    setTime(at);
    setView(next);
  }

  if (!source || !episode || !entered) {
    return (
      <LocalOpener
        source={source}
        subtitles={subtitles}
        onSource={(opened) => { setSource(opened); setTime(0); }}
        onEnter={enter}
      />
    );
  }

  return (
    <main className="page-shell local-studio">
      <div className="studio-heading local-studio-heading">
        <div>
          <p className="section-kicker">Decoded by {source.kind === "native" ? "this browser" : "FFmpeg"}</p>
          <h1>{episode.title}</h1>
          <p className="local-lede">
            {captions.length
              ? `${captions.length.toLocaleString()} lines · `
              : "No subtitles · "}
            {formatTime(source.duration)} · {source.width}×{source.height}
          </p>
        </div>
        <div className="local-choice">
          {captions.length === 0 && (
            <button className="secondary-action" type="button" onClick={() => setEntered(false)}>Add subtitles</button>
          )}
          <button className="secondary-action" type="button" onClick={() => setEntered(false)}>Set-up</button>
        </div>
      </div>

      <nav className="local-tabs" aria-label="Studio sections">
        {/* Nothing to search without subtitles, so the tab is not offered. */}
        {captions.length > 0 && (
          <button className={view === "search" ? "active" : ""} type="button" onClick={() => setView("search")}>Search</button>
        )}
        <button className={view === "scene" ? "active" : ""} type="button" onClick={() => setView("scene")}>Scene · {formatTime(time)}</button>
        <button className={view === "image" ? "active" : ""} type="button" onClick={() => setView("image")}>Image</button>
        <button className={view === "gif" ? "active" : ""} type="button" onClick={() => setView("gif")}>GIF</button>
      </nav>

      {view === "search" && captions.length > 0 && <LocalSearch source={source} episode={episode} config={config} onOpen={goTo} />}
      {view === "scene" && <LocalScene source={source} episode={episode} config={config} time={time} onTime={setTime} onOpen={goTo} onAddSubtitles={() => setEntered(false)} />}
      {view === "image" && <LocalImageEditor source={source} episode={episode} time={time} onTime={setTime} onBack={() => setView("scene")} />}
      {view === "gif" && <LocalGifEditor source={source} episode={episode} config={config} time={time} onBack={() => setView("scene")} />}
    </main>
  );
}
