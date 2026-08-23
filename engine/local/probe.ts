/**
 * Reads FFmpeg's banner.
 *
 * ffmpeg.wasm ships no ffprobe, but `ffmpeg -i <file>` describes every stream
 * on stderr before it exits. Parsing that text is how the local studio learns a
 * file's duration, dimensions and which subtitle tracks are attached.
 *
 * Like the subtitle parser, this imports nothing so it can be tested directly.
 */

export type ProbedVideo = {
  width: number;
  height: number;
  frameRate: number | null;
  codec: string;
  /** Degrees of display rotation; portrait phone footage reports 90 or 270. */
  rotation: number;
};

export type ProbedSubtitle = {
  /** Position among subtitle streams, which is what `-map 0:s:N` selects. */
  index: number;
  /** Position among all streams, shown to help identify the track. */
  streamIndex: number;
  codec: string;
  language: string | null;
  title: string | null;
  /** Bitmap tracks are pictures of words, so they cannot become searchable text. */
  textBased: boolean;
  default: boolean;
  forced: boolean;
};

export type ProbedMedia = {
  durationSeconds: number;
  video: ProbedVideo | null;
  subtitles: ProbedSubtitle[];
};

const BITMAP_SUBTITLE_CODECS = ["hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle", "dvb_teletext", "xsub"];

export function isTextSubtitle(codec: string) {
  return !BITMAP_SUBTITLE_CODECS.includes(codec.toLowerCase());
}

function durationFrom(banner: string) {
  const match = banner.match(/Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d{1,3})/);
  if (!match) return 0;
  const [, hours, minutes, seconds, fraction] = match;
  return (Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds) + Number(fraction.padEnd(2, "0")) / 100;
}

/**
 * Metadata is indented under the stream it belongs to, so a track's title is
 * whatever `title :` line appears before the next `Stream #` line.
 */
function titleAfter(lines: string[], from: number) {
  for (let index = from + 1; index < lines.length; index += 1) {
    if (/^\s*(Stream #|Input #|Output #|Duration:)/.test(lines[index])) break;
    const title = lines[index].match(/^\s*title\s*:\s*(.+?)\s*$/);
    if (title) return title[1];
  }
  return null;
}

export function parseFfmpegBanner(banner: string): ProbedMedia {
  const lines = banner.replace(/\r/g, "").split("\n");
  let video: ProbedVideo | null = null;
  const subtitles: ProbedSubtitle[] = [];

  // A plain loop, not forEach: TypeScript widens a `let` back to its declared
  // type once a closure assigns to it, which would lose the video we just found.
  for (let position = 0; position < lines.length; position += 1) {
    const line = lines[position];
    const stream = line.match(/^\s*Stream #\d+:(\d+)(?:\[[^\]]*\])?(?:\(([^)]+)\))?:\s*(Video|Subtitle):\s*([^\s,(]+)/);
    if (!stream) continue;
    const [, streamIndex, language, kind, codec] = stream;

    if (kind === "Video") {
      // The first video stream wins; later ones are cover art or thumbnails.
      if (video) continue;
      const size = line.match(/,\s(\d{2,5})x(\d{2,5})/);
      if (!size) continue;
      const frameRate = line.match(/,\s*([\d.]+)\s*fps/);
      video = {
        width: Number(size[1]),
        height: Number(size[2]),
        frameRate: frameRate ? Number(frameRate[1]) : null,
        codec,
        rotation: rotationAfter(lines, position),
      };
      continue;
    }

    subtitles.push({
      index: subtitles.length,
      streamIndex: Number(streamIndex),
      codec,
      language: language && language !== "und" ? language : null,
      title: titleAfter(lines, position),
      textBased: isTextSubtitle(codec),
      default: /\(default\)/.test(line),
      forced: /\(forced\)/.test(line),
    });
  }

  return { durationSeconds: durationFrom(banner), video, subtitles };
}

/** `Side data: displaymatrix: rotation of -90.00 degrees` follows the stream line. */
function rotationAfter(lines: string[], from: number) {
  for (let index = from + 1; index < lines.length; index += 1) {
    if (/^\s*Stream #/.test(lines[index])) break;
    const rotation = lines[index].match(/rotation of (-?[\d.]+) degrees/);
    if (rotation) return ((Math.round(Number(rotation[1])) % 360) + 360) % 360;
  }
  return 0;
}

export function subtitleTrackLabel(track: ProbedSubtitle) {
  const parts = [track.title, track.language?.toUpperCase()].filter(Boolean);
  const name = parts.length ? parts.join(" · ") : `Track ${track.index + 1}`;
  const flags = [track.default ? "default" : null, track.forced ? "forced" : null, track.textBased ? null : "image"]
    .filter(Boolean)
    .join(", ");
  return flags ? `${name} (${flags})` : name;
}

/** Picks the track a viewer most likely wants: default first, then any text track. */
export function preferredSubtitle(tracks: ProbedSubtitle[]) {
  const text = tracks.filter((track) => track.textBased);
  return text.find((track) => track.default && !track.forced) ?? text.find((track) => !track.forced) ?? text[0] ?? null;
}
