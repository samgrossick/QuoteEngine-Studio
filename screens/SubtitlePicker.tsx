import { useRef } from "react";
import { formatTime } from "@/engine/media";
import { subtitleTrackLabel } from "@/engine/local/probe";
import type { LocalSource } from "@/engine/local/source";
import type { Subtitles } from "../useSubtitles";

const SUBTITLE_ACCEPT = ".srt,.vtt,.ass,.ssa,text/vtt,application/x-subrip";

/**
 * Where the words come from.
 *
 * What this offers depends on what the container already told us, so that the
 * visitor is only asked for a subtitle file when there is genuinely nothing to
 * find in the video itself.
 */
export function SubtitlePicker({ source, subtitles }: { source: LocalSource; subtitles: Subtitles }) {
  const input = useRef<HTMLInputElement>(null);
  const { tracks, cues, name, busy } = subtitles;
  const textTracks = tracks?.filter((track) => track.textBased) ?? [];
  const last = cues[cues.length - 1];

  return (
    <>
      <input
        className="sr-only"
        ref={input}
        type="file"
        accept={SUBTITLE_ACCEPT}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void subtitles.openFile(file);
        }}
      />

      {name ? (
        <div className="local-summary-line">
          <strong>{cues.length.toLocaleString()} lines</strong> from {name}
          {cues.length > 0 && <> · {formatTime(cues[0].startMs / 1000)} to {formatTime(last.startMs / 1000)}</>}
        </div>
      ) : tracks === null ? (
        <p className="control-help">
          This container is not one the studio can read directly. Open a subtitle file, or let FFmpeg look inside
          the video.
        </p>
      ) : textTracks.length === 0 ? (
        <p className="control-help">
          No subtitles are stored in this file. Open a subtitle file if you have one — or carry on without, and
          type your own captions.
        </p>
      ) : null}

      <div className="local-choice">
        <button className="secondary-action" type="button" disabled={busy} onClick={() => input.current?.click()}>
          {name ? "Use a different subtitle file" : "Open a subtitle file"}
        </button>
        {tracks === null && (
          <button className="secondary-action" type="button" disabled={busy} onClick={() => void subtitles.inspect(source)}>
            Look inside the video
          </button>
        )}
      </div>

      {/* Only worth showing when there is a choice to make. */}
      {textTracks.length > 1 && <ul className="local-tracks">
        {textTracks.map((track) => (
          <li key={track.index}>
            <button
              type="button"
              disabled={busy}
              className={name === subtitleTrackLabel(track) ? "active" : ""}
              onClick={() => void subtitles.chooseTrack(source, track)}
            >
              <strong>{subtitleTrackLabel(track)}</strong>
              <span>{track.codec}</span>
            </button>
          </li>
        ))}
      </ul>}

      {cues.length > 0 && <label className="local-offset">
        Nudge the timing
        <input
          type="range"
          min="-10"
          max="10"
          step="0.1"
          value={subtitles.offsetSeconds}
          onChange={(event) => subtitles.setOffsetSeconds(Number(event.target.value))}
        />
        <strong>{subtitles.offsetSeconds > 0 ? "+" : ""}{subtitles.offsetSeconds.toFixed(1)}s</strong>
      </label>}
    </>
  );
}
