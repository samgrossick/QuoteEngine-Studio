import { useCallback, useMemo, useState } from "react";
import { fileReader, sniffSubtitleTracks } from "@/engine/local/containers";
import { preferredSubtitle, subtitleTrackLabel, type ProbedSubtitle } from "@/engine/local/probe";
import {
  decodeSubtitleBytes,
  detectSubtitleFormat,
  parseSubtitles,
  type SubtitleCue,
  type SubtitleFormat,
} from "@/engine/local/subtitles";
import type { LocalSource } from "@/engine/local/source";

type Loaded = { name: string; text: string; format: SubtitleFormat };

export type Subtitles = {
  /** Embedded tracks, or null when the container could not be read. */
  tracks: ProbedSubtitle[] | null;
  /** Where the loaded cues came from, for the interface to name. */
  name: string | null;
  cues: SubtitleCue[];
  offsetSeconds: number;
  busy: boolean;
  status: string;
  detail: string;
  error: string | null;
  setOffsetSeconds: (seconds: number) => void;
  /** Reads the container index and loads the obvious track, if there is one. */
  detect: (source: LocalSource) => Promise<void>;
  openFile: (file: File) => Promise<void>;
  chooseTrack: (source: LocalSource, track: ProbedSubtitle) => Promise<void>;
  /** Asks FFmpeg directly, for containers the index reader does not know. */
  inspect: (source: LocalSource) => Promise<void>;
  reset: () => void;
};

/**
 * Finding the words that go with a video.
 *
 * Three ways in, in order of how much they cost: a subtitle file the visitor
 * picks, a track the container index says is there, and FFmpeg reading the
 * file itself. The first needs nothing, the second needs only a few kilobytes
 * of header, and only the third pays for the engine.
 */
export function useSubtitles(): Subtitles {
  const [tracks, setTracks] = useState<ProbedSubtitle[] | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [offsetSeconds, setOffsetSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const cues = useMemo(
    () => loaded ? parseSubtitles(loaded.text, loaded.format, Math.round(offsetSeconds * 1000)) : [],
    [loaded, offsetSeconds],
  );

  const reset = useCallback(() => {
    setTracks(null);
    setLoaded(null);
    setOffsetSeconds(0);
    setError(null);
    setStatus("");
    setDetail("");
  }, []);

  const extract = useCallback(async (source: LocalSource, track: ProbedSubtitle) => {
    if (!track.textBased) {
      setError(`${subtitleTrackLabel(track)} is a picture of the words rather than the words themselves, so it cannot be searched. Choose a text track, or open a subtitle file.`);
      return;
    }
    setError(null);
    setBusy(true);
    // Naming the size matters: this is the only step that downloads the engine.
    setStatus(`Reading “${subtitleTrackLabel(track)}” from the video…`);
    try {
      const text = await source.extractSubtitles(track.index, (message) => setDetail(message));
      if (parseSubtitles(text, "srt").length === 0) throw new Error("That track contained no dialogue.");
      setLoaded({ name: subtitleTrackLabel(track), text, format: "srt" });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "That subtitle track could not be read.");
    } finally {
      setBusy(false);
      setStatus("");
      setDetail("");
    }
  }, []);

  const detect = useCallback(async (source: LocalSource) => {
    reset();
    setBusy(true);
    setStatus("Looking for subtitles in the file…");
    try {
      // Decoding the file already listed its streams, so that answer is free.
      const found = source.initialSubtitleTracks
        ?? (await sniffSubtitleTracks(fileReader(source.file), source.file.size))?.tracks
        ?? null;
      setTracks(found);
      const best = found && preferredSubtitle(found);
      setBusy(false);
      setStatus("");
      if (best) await extract(source, best);
    } catch {
      // A container that cannot be read is not an error: it just means the
      // visitor has to say where the subtitles are.
      setTracks(null);
      setBusy(false);
      setStatus("");
    }
  }, [extract, reset]);

  const openFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const text = decodeSubtitleBytes(await file.arrayBuffer());
      const format = detectSubtitleFormat(file.name, text);
      if (!format) throw new Error(`${file.name} does not look like a subtitle file.`);
      if (parseSubtitles(text, format).length === 0) throw new Error(`No dialogue could be read from ${file.name}.`);
      setOffsetSeconds(0);
      setLoaded({ name: file.name, text, format });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "That subtitle file could not be read.");
    }
  }, []);

  const inspect = useCallback(async (source: LocalSource) => {
    setError(null);
    setBusy(true);
    setStatus("Loading the FFmpeg engine so the embedded tracks can be read…");
    try {
      const found = await source.inspectSubtitles((message) => setDetail(message));
      setTracks(found);
      setBusy(false);
      setStatus("");
      setDetail("");
      if (found.length === 0) {
        setError("This file has no embedded subtitle tracks. Open a subtitle file, or carry on without one.");
        return;
      }
      const best = preferredSubtitle(found);
      if (best) await extract(source, best);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "The subtitle tracks could not be read.");
      setBusy(false);
      setStatus("");
      setDetail("");
    }
  }, [extract]);

  return {
    tracks,
    name: loaded?.name ?? null,
    cues,
    offsetSeconds,
    busy,
    status,
    detail,
    error,
    setOffsetSeconds,
    detect,
    openFile,
    chooseTrack: extract,
    inspect,
    reset,
  };
}
