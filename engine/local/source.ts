"use client";

/**
 * One video file, opened locally, behind one interface.
 *
 * The browser is tried first: if `<video>` can decode the file, seeking it is
 * far faster than anything WebAssembly can manage, and no 32 MB engine has to
 * load at all. Matroska and everything else falls through to FFmpeg.
 *
 * Whichever path decodes the pictures, subtitles are separate. A sidecar file
 * needs no engine; a track *inside* the container always does, because no
 * browser exposes embedded subtitle streams to script. So a natively decodable
 * MP4 with embedded subtitles loads FFmpeg for the text and never uses it for
 * the frames — which is the whole point of doing this hybrid.
 *
 * Nothing here uploads anything. Every path is a local file, a blob URL, or
 * wasm memory.
 */

import { createFrameGrabber, loadedVideo, type FrameGrabber } from "./frames";
import { loadFFmpeg, type FFmpegProgress, type LocalFFmpeg } from "./ffmpeg-client";
import { parseFfmpegBanner, type ProbedSubtitle } from "./probe";

export type LocalSourceKind = "native" | "ffmpeg";

/** A stretch of the programme the browser can play natively. */
export type ProxyClip = {
  url: string;
  /** The source time that clip time zero corresponds to. */
  offset: number;
  duration: number;
  release(): void;
};

export type LocalSource = {
  kind: LocalSourceKind;
  file: File;
  duration: number;
  width: number;
  height: number;
  frameRate: number | null;
  /** Known up front only when the container was inspected to decode it. */
  initialSubtitleTracks: ProbedSubtitle[] | null;
  /** Loads FFmpeg if it is not already up, and lists embedded subtitle tracks. */
  inspectSubtitles(onStatus?: (message: string) => void): Promise<ProbedSubtitle[]>;
  /** Converts one embedded track to SRT text. */
  extractSubtitles(index: number, onStatus?: (message: string) => void): Promise<string>;
  /** A scaled still, cached by time and width. */
  frame(time: number, width: number): Promise<string>;
  /** A playable clip covering the given range, for scrubbing and export. */
  proxy(start: number, end: number, width: number, onProgress?: FFmpegProgress): Promise<ProxyClip>;
  release(): void;
};

const NATIVE_PROBE_TIMEOUT_MS = 20_000;

function withTimeout<T>(work: Promise<T>, ms: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** Serves the FFmpeg engine with this file mounted, loading it only on demand. */
function ffmpegSessionFactory(file: File) {
  let pending: Promise<{ ffmpeg: LocalFFmpeg; path: string }> | null = null;
  return {
    session(onStatus?: (message: string) => void) {
      pending ??= (async () => {
        const ffmpeg = await loadFFmpeg(onStatus);
        const path = await ffmpeg.mountFile(file);
        return { ffmpeg, path };
      })().catch((error: unknown) => {
        pending = null;
        throw error;
      });
      return pending;
    },
    started: () => pending !== null,
    async dispose() {
      if (!pending) return;
      const { ffmpeg } = await pending.catch(() => ({ ffmpeg: null }));
      await ffmpeg?.unmountFile().catch(() => undefined);
      pending = null;
    },
  };
}

let outputCounter = 0;

function nextOutput(extension: string) {
  outputCounter += 1;
  return `local-${outputCounter}.${extension}`;
}

/**
 * Reads FFmpeg's own description of the file by running it with no output.
 *
 * `-loglevel info` is set explicitly rather than left to the default. The log
 * level is global state inside the wasm instance and survives between runs, so
 * once any other command here has passed `-loglevel error`, the stream listing
 * this depends on would be silently suppressed and every file would look as
 * though it had no video and no subtitle tracks at all.
 */
async function probeWithFfmpeg(ffmpeg: LocalFFmpeg, path: string) {
  return parseFfmpegBanner(await ffmpeg.exec(["-hide_banner", "-loglevel", "info", "-i", path]));
}

async function extractSubtitleTrack(ffmpeg: LocalFFmpeg, path: string, index: number) {
  const output = nextOutput("srt");
  // Normalising every text format to SRT means the parser only meets one
  // shape here; styling is lost, which a meme caption never wanted anyway.
  await ffmpeg.exec([
    "-hide_banner", "-loglevel", "error",
    "-i", path,
    "-map", `0:s:${index}`,
    "-c:s", "srt",
    "-vn", "-an", "-dn",
    "-f", "srt",
    "-y", output,
  ]);
  const data = await ffmpeg.read(output);
  await ffmpeg.remove(output);
  const text = new TextDecoder("utf-8").decode(data);
  if (!text.trim()) throw new Error("That subtitle track came out empty. Try another track, or open a subtitle file.");
  return text;
}

function subtitleAccess(factory: ReturnType<typeof ffmpegSessionFactory>, known: ProbedSubtitle[] | null) {
  let tracks = known;
  return {
    async inspect(onStatus?: (message: string) => void) {
      if (tracks) return tracks;
      const { ffmpeg, path } = await factory.session(onStatus);
      tracks = (await probeWithFfmpeg(ffmpeg, path)).subtitles;
      return tracks;
    },
    async extract(index: number, onStatus?: (message: string) => void) {
      const { ffmpeg, path } = await factory.session(onStatus);
      return extractSubtitleTrack(ffmpeg, path, index);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Native path                                                                */
/* -------------------------------------------------------------------------- */

type NativeProbe = { url: string; width: number; height: number; duration: number };

async function probeNatively(file: File): Promise<NativeProbe | null> {
  const url = URL.createObjectURL(file);
  try {
    // `loadeddata` rather than `loadedmetadata`: a container the browser can
    // parse but not decode reports metadata happily and then never paints.
    const video = await withTimeout(loadedVideo(url), NATIVE_PROBE_TIMEOUT_MS, "Timed out decoding this file.");
    const { videoWidth: width, videoHeight: height, duration } = video;
    video.removeAttribute("src");
    video.load();
    if (!width || !height || !Number.isFinite(duration) || duration <= 0) throw new Error("No decodable video track.");
    return { url, width, height, duration };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function nativeSource(file: File, probe: NativeProbe): LocalSource {
  const factory = ffmpegSessionFactory(file);
  const subtitles = subtitleAccess(factory, null);
  const grabber = createFrameGrabber(probe.url);
  // One stable object, so a scrubbing interface does not see a new clip on
  // every frame and reload the element underneath itself.
  const wholeFile: ProxyClip = { url: probe.url, offset: 0, duration: probe.duration, release: () => undefined };

  return {
    kind: "native",
    file,
    duration: probe.duration,
    width: probe.width,
    height: probe.height,
    frameRate: null,
    initialSubtitleTracks: null,
    inspectSubtitles: subtitles.inspect,
    extractSubtitles: subtitles.extract,
    frame: (time, width) => grabber.frame(time, width),
    // The whole file already plays, so a "proxy" is the file itself.
    proxy: async () => wholeFile,
    release() {
      grabber.release();
      URL.revokeObjectURL(probe.url);
      void factory.dispose();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* FFmpeg path                                                                */
/* -------------------------------------------------------------------------- */

type ActiveProxy = { start: number; end: number; url: string; grabber: FrameGrabber };

function ffmpegSource(
  file: File,
  factory: ReturnType<typeof ffmpegSessionFactory>,
  probe: { duration: number; width: number; height: number; frameRate: number | null; subtitles: ProbedSubtitle[] },
): LocalSource {
  const subtitles = subtitleAccess(factory, probe.subtitles);
  let active: ActiveProxy | null = null;

  function dropProxy() {
    if (!active) return;
    active.grabber.release();
    URL.revokeObjectURL(active.url);
    active = null;
  }

  return {
    kind: "ffmpeg",
    file,
    duration: probe.duration,
    width: probe.width,
    height: probe.height,
    frameRate: probe.frameRate,
    initialSubtitleTracks: probe.subtitles,
    inspectSubtitles: subtitles.inspect,
    extractSubtitles: subtitles.extract,

    async frame(time, width) {
      // A transcoded window is already decodable, so prefer seeking it over
      // paying for another FFmpeg pass across the whole file.
      if (active && time >= active.start && time <= active.end) {
        return active.grabber.frame(time - active.start, width);
      }
      const { ffmpeg, path } = await factory.session();
      const output = nextOutput("jpg");
      await ffmpeg.exec([
        "-hide_banner", "-loglevel", "error",
        // Seeking before -i lets FFmpeg jump to a keyframe instead of decoding
        // from the start, which is the difference between seconds and minutes.
        "-ss", time.toFixed(3),
        "-i", path,
        "-frames:v", "1",
        "-vf", `scale=${Math.min(width, probe.width)}:-2`,
        "-q:v", "4",
        "-f", "image2",
        "-y", output,
      ]);
      const data = await ffmpeg.read(output);
      await ffmpeg.remove(output);
      return URL.createObjectURL(new Blob([data], { type: "image/jpeg" }));
    },

    async proxy(start, end, width, onProgress) {
      const from = Math.max(0, start);
      const duration = Math.max(0.2, Math.min(probe.duration, end) - from);
      if (active && active.start <= from && active.end >= from + duration) {
        return { url: active.url, offset: active.start, duration: active.end - active.start, release: () => undefined };
      }
      const { ffmpeg, path } = await factory.session();
      const output = nextOutput("mp4");
      await ffmpeg.exec([
        "-hide_banner", "-loglevel", "error",
        "-ss", from.toFixed(3),
        "-i", path,
        "-t", duration.toFixed(3),
        "-an", "-sn", "-dn",
        "-vf", `scale=${Math.min(width, probe.width)}:-2`,
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-y", output,
      ], onProgress);
      const data = await ffmpeg.read(output);
      await ffmpeg.remove(output);
      const url = URL.createObjectURL(new Blob([data], { type: "video/mp4" }));
      dropProxy();
      active = { start: from, end: from + duration, url, grabber: createFrameGrabber(url) };
      return { url, offset: from, duration, release: () => undefined };
    },

    release() {
      dropProxy();
      void factory.dispose();
    },
  };
}

/* -------------------------------------------------------------------------- */

export class UnsupportedMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedMediaError";
  }
}

/**
 * Opens a picked file, choosing the cheapest path that can decode it.
 * `onStatus` receives FFmpeg's log lines so the interface can explain a wait.
 */
export async function openLocalSource(file: File, onStatus?: (message: string) => void): Promise<LocalSource> {
  const native = await probeNatively(file);
  if (native) return nativeSource(file, native);

  const factory = ffmpegSessionFactory(file);
  const { ffmpeg, path } = await factory.session(onStatus);
  const probed = await probeWithFfmpeg(ffmpeg, path);
  if (!probed.video || probed.durationSeconds <= 0) {
    await factory.dispose();
    throw new UnsupportedMediaError(`No video track could be found in ${file.name}.`);
  }

  // FFmpeg rotates on output by default, so a portrait recording reports its
  // stored, unrotated size here. Swap it to match what will actually be drawn.
  const upright = probed.video.rotation === 90 || probed.video.rotation === 270;
  return ffmpegSource(file, factory, {
    duration: probed.durationSeconds,
    width: upright ? probed.video.height : probed.video.width,
    height: upright ? probed.video.width : probed.video.height,
    frameRate: probed.video.frameRate,
    subtitles: probed.subtitles,
  });
}
