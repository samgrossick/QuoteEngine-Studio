import { useRef, useState } from "react";
import { formatTime } from "@/engine/media";
import { openLocalSource, type LocalSource } from "@/engine/local/source";
import type { Subtitles } from "../useSubtitles";
import { SubtitlePicker } from "./SubtitlePicker";

const VIDEO_ACCEPT = "video/*,.mkv,.mp4,.m4v,.mov,.webm,.avi,.ts,.m2ts,.mpg,.mpeg,.wmv,.flv";

/**
 * Set-up: which file, and where its words come from.
 *
 * Controlled by the workspace, which owns the source and the subtitles. That
 * means this screen can be returned to at any point — to swap the video, or to
 * add subtitles to something already open — without losing anything.
 */
export function LocalOpener({ source, subtitles, onSource, onEnter }: {
  source: LocalSource | null;
  subtitles: Subtitles;
  onSource: (source: LocalSource) => void;
  onEnter: () => void;
}) {
  const [opening, setOpening] = useState(false);
  const [status, setStatus] = useState("");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  async function chooseVideo(file: File) {
    subtitles.reset();
    setError(null);
    setDetail("");
    setOpening(true);
    setStatus("Checking whether this browser can decode the file…");
    try {
      const opened = await openLocalSource(file, (message) => setDetail(message));
      onSource(opened);
      setStatus("");
      setDetail("");
      setOpening(false);
      // Reading the container index costs a few kilobytes, so the visitor is
      // only asked for a subtitle file when the video really has none.
      await subtitles.detect(opened);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "That file could not be opened.");
      setStatus("");
      setOpening(false);
    }
  }

  const busy = opening || subtitles.busy;
  const ready = source !== null && !opening;

  return (
    <main className="page-shell local-opener">
      <div className="page-heading">
        <p className="section-kicker">Set-up</p>
        <h1>Open a video from this device.</h1>
        <p className="local-lede">
          The file is read in this browser tab and never leaves it. Pick a video and the studio finds its
          subtitles if it has any — then search what was said, or just scrub to a moment and type your own.
        </p>
      </div>

      <ol className="local-steps">
        <li className={source ? "local-step done" : "local-step active"}>
          <div className="local-step-head"><span>01</span><h2>Choose the video</h2></div>
          <input
            className="sr-only"
            ref={videoInput}
            type="file"
            accept={VIDEO_ACCEPT}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void chooseVideo(file);
            }}
          />
          <button className="primary-action wide-action" type="button" disabled={busy} onClick={() => videoInput.current?.click()}>
            {source ? "Choose a different video" : "Choose a video file"}
          </button>
          {source && <dl className="local-summary">
            <div><dt>File</dt><dd>{source.file.name}</dd></div>
            <div><dt>Length</dt><dd>{formatTime(source.duration)}</dd></div>
            <div><dt>Size</dt><dd>{source.width}×{source.height}</dd></div>
            <div><dt>Decoder</dt><dd>{source.kind === "native" ? "This browser" : "FFmpeg (WebAssembly)"}</dd></div>
          </dl>}
          {source?.kind === "ffmpeg" && <p className="control-help">
            This browser cannot play {source.file.name.split(".").pop()?.toUpperCase()} directly, so FFmpeg decodes it
            here in the page. Editing a moment transcodes a short window first, which takes a few seconds.
          </p>}
        </li>

        <li className={!source ? "local-step" : subtitles.cues.length ? "local-step done" : "local-step active"}>
          <div className="local-step-head">
            <span>02</span>
            <h2>Subtitles{subtitles.cues.length ? "" : " (optional)"}</h2>
          </div>
          {source
            ? <SubtitlePicker source={source} subtitles={subtitles} />
            : <p className="control-help">Whatever is stored in the video will be found automatically.</p>}
        </li>

        <li className={ready ? "local-step active" : "local-step"}>
          <div className="local-step-head"><span>03</span><h2>Start making things</h2></div>
          <button
            className="primary-action accent-action wide-action"
            type="button"
            disabled={!ready}
            onClick={onEnter}
          >
            {subtitles.cues.length ? "Open the studio" : "Open the studio without subtitles"}
          </button>
          {ready && subtitles.cues.length === 0 && <p className="control-help">
            You can still scrub to any moment and write your own captions, and add subtitles later.
          </p>}
        </li>
      </ol>

      {(busy || subtitles.status) && <div className="local-status" role="status" aria-live="polite">
        <progress aria-label="Opening progress" />
        <strong>{status || subtitles.status || "Working…"}</strong>
        {(detail || subtitles.detail) && <code>{detail || subtitles.detail}</code>}
      </div>}
      {(error || subtitles.error) && <p className="local-error" role="alert">{error || subtitles.error}</p>}
    </main>
  );
}
