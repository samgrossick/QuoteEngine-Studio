/**
 * Subtitle parsing for locally opened media.
 *
 * This module deliberately imports nothing. The ingest pipeline parses SRT in
 * Node and the browser parses SRT, WebVTT and ASS from a file the visitor
 * picked, so the same source has to load under `node --test` type stripping and
 * inside the bundler. Keeping it dependency-free is what makes that work.
 */

export type SubtitleFormat = "srt" | "vtt" | "ass";

export type SubtitleCue = {
  id: number;
  startMs: number;
  endMs: number;
  timestamp: string;
  text: string;
  speaker: string | null;
  /** Midpoint of the cue, rounded to a tenth of a second, used to pick a frame. */
  frameTime: number;
};

/** Accepts SRT commas, WebVTT dots, bare `MM:SS.mmm`, and ASS centiseconds. */
export function parseTimestamp(value: string) {
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/);
  if (!match) return null;
  const [, hours, minutes, seconds, fraction] = match;
  const milliseconds = Number(fraction.padEnd(3, "0"));
  return ((Number(hours ?? 0) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + milliseconds;
}

export function formatTimestamp(milliseconds: number) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

/** Strips the markup each format layers over the words themselves. */
function cleanText(raw: string, format: SubtitleFormat) {
  let text = raw;
  if (format === "ass") {
    // Override blocks carry positioning and karaoke timing, never dialogue.
    text = text.replace(/\{[^}]*\}/g, "").replace(/\\[Nn]/g, " ").replace(/\\h/g, " ");
  }
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** `<v Roy>` in WebVTT, or a shouted `ROY:` prefix in the other two. */
function speakerFor(raw: string, text: string, assName?: string) {
  if (assName) return assName;
  const voice = raw.match(/<v(?:\.[^\s>]+)*\s+([^>]+)>/);
  if (voice) return voice[1].trim();
  return text.match(/^([A-Z][A-Z ]{1,24}):\s*/)?.[1] ?? null;
}

export function detectSubtitleFormat(fileName: string, source: string): SubtitleFormat | null {
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension === "srt") return "srt";
  if (extension === "vtt") return "vtt";
  if (extension === "ass" || extension === "ssa") return "ass";
  if (/^\uFEFF?WEBVTT/.test(source)) return "vtt";
  if (/^\uFEFF?\[Script Info\]/im.test(source) || /^Dialogue:/m.test(source)) return "ass";
  if (/-->/.test(source)) return "srt";
  return null;
}

type RawCue = { startMs: number; endMs: number; raw: string; assName?: string };

/** SRT and WebVTT share a block structure; only the separators differ. */
function parseCueBlocks(source: string): RawCue[] {
  const cues: RawCue[] = [];
  for (const block of source.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0 || /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex === -1) continue;
    // WebVTT appends cue settings (`line:90% align:middle`) after the end time.
    const [from, to] = lines[timingIndex].split("-->");
    const startMs = parseTimestamp(from);
    const endMs = parseTimestamp(to?.trim().split(/\s+/)[0] ?? "");
    if (startMs === null || endMs === null) continue;
    cues.push({ startMs, endMs, raw: lines.slice(timingIndex + 1).join(" ") });
  }
  return cues;
}

/** ASS declares its own column order, so the `Format:` line decides the indexes. */
function parseAssEvents(source: string): RawCue[] {
  const lines = source.replace(/\r/g, "").split("\n");
  let columns: string[] = ["Layer", "Start", "End", "Style", "Name", "MarginL", "MarginR", "MarginV", "Effect", "Text"];
  const cues: RawCue[] = [];
  let inEvents = false;
  for (const line of lines) {
    if (/^\s*\[/.test(line)) { inEvents = /^\s*\[Events\]/i.test(line); continue; }
    if (!inEvents) continue;
    if (/^\s*Format\s*:/i.test(line)) {
      columns = line.slice(line.indexOf(":") + 1).split(",").map((name) => name.trim());
      continue;
    }
    if (!/^\s*Dialogue\s*:/i.test(line)) continue;
    // Text is always last and may itself contain commas, so it takes the remainder.
    const fields = line.slice(line.indexOf(":") + 1).split(",");
    const textIndex = columns.indexOf("Text");
    if (textIndex === -1) continue;
    const values = [...fields.slice(0, textIndex), fields.slice(textIndex).join(",")];
    const startMs = parseTimestamp(values[columns.indexOf("Start")] ?? "");
    const endMs = parseTimestamp(values[columns.indexOf("End")] ?? "");
    if (startMs === null || endMs === null) continue;
    const assName = values[columns.indexOf("Name")]?.trim();
    cues.push({ startMs, endMs, raw: values[textIndex] ?? "", assName: assName || undefined });
  }
  return cues;
}

/**
 * Turns a subtitle document into cues in playback order. Cues that carry no
 * words after markup is stripped are dropped, so signs and karaoke fills do not
 * become empty search results.
 */
export function parseSubtitles(source: string, format: SubtitleFormat, offsetMs = 0): SubtitleCue[] {
  const stripped = source.replace(/^\uFEFF/, "");
  const raw = format === "ass" ? parseAssEvents(stripped) : parseCueBlocks(stripped);
  return raw
    .map((cue) => {
      const text = cleanText(cue.raw, format);
      const startMs = Math.max(0, cue.startMs + offsetMs);
      const endMs = Math.max(startMs, cue.endMs + offsetMs);
      return { startMs, endMs, text, speaker: speakerFor(cue.raw, text, cue.assName) };
    })
    .filter((cue) => cue.text.length > 0 && cue.endMs > cue.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
    .map((cue, index) => ({
      id: index + 1,
      startMs: cue.startMs,
      endMs: cue.endMs,
      timestamp: formatTimestamp(cue.startMs),
      text: cue.text,
      speaker: cue.speaker,
      frameTime: Math.round((cue.startMs + cue.endMs) / 2 / 100) / 10,
    }));
}

/**
 * Decodes a subtitle file's bytes.
 *
 * `File.text()` always assumes UTF-8, which turns the accented characters in
 * older subtitle files into replacement glyphs. Strict UTF-8 is tried first so
 * that genuinely legacy files can fall back to Windows-1252 instead.
 */
export function decodeSubtitleBytes(bytes: Uint8Array | ArrayBuffer) {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(view);
  } catch {
    return new TextDecoder("windows-1252").decode(view);
  }
}
