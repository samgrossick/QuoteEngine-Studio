/**
 * Finds the subtitle tracks inside a container without decoding anything.
 *
 * The studio needs to answer one question the moment a file is picked: are
 * there subtitles in here already? Asking FFmpeg would answer it perfectly and
 * cost a 32 MB download every time, including for the common case of an MP4
 * with a subtitle file beside it, where the engine is never needed at all.
 *
 * So the container's own index is read instead. MP4 keeps it in `moov` and
 * Matroska in `Tracks`; both are small, near the front, and reachable by
 * following box or element sizes rather than scanning bytes. Extracting the
 * text still needs FFmpeg — but now it is only fetched when there is something
 * to extract.
 *
 * Only types are imported, so this module also loads under `node --test`.
 */

import type { ProbedSubtitle } from "./probe";

/** Reads `length` bytes at `offset`. Backed by File.slice in the browser. */
export type ByteReader = (offset: number, length: number) => Promise<Uint8Array>;

export type SniffedContainer = {
  container: "mp4" | "matroska";
  tracks: ProbedSubtitle[];
};

/** Header reads are tiny; this only bounds a malformed file's damage. */
const MAX_INDEX_BYTES = 64 * 1024 * 1024;
const BOX_HEADER = 16;

function big(bytes: Uint8Array, offset: number, length: number) {
  let value = 0;
  for (let index = 0; index < length; index += 1) value = value * 256 + bytes[offset + index];
  return value;
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  let out = "";
  for (let index = 0; index < length; index += 1) out += String.fromCharCode(bytes[offset + index]);
  return out;
}

/* -------------------------------------------------------------------------- */
/* MP4 / QuickTime                                                            */
/* -------------------------------------------------------------------------- */

const MP4_SUBTITLE_HANDLERS = ["sbtl", "text", "subp", "clcp"];

/** `tx3g` and friends, mapped to the names FFmpeg reports for the same thing. */
const MP4_CODECS: Record<string, { codec: string; textBased: boolean }> = {
  tx3g: { codec: "mov_text", textBased: true },
  text: { codec: "text", textBased: true },
  wvtt: { codec: "webvtt", textBased: true },
  stpp: { codec: "ttml", textBased: true },
  c608: { codec: "eia_608", textBased: true },
  c708: { codec: "eia_708", textBased: true },
  mp4s: { codec: "dvd_subtitle", textBased: false },
};

type Box = { type: string; start: number; end: number };

/** Walks the boxes directly inside [start, end), without descending. */
function boxesIn(bytes: Uint8Array, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = big(bytes, at, 4);
    const type = ascii(bytes, at + 4, 4);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) break;
      size = big(bytes, at + 8, 8);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) break;
    boxes.push({ type, start: at + header, end: at + size });
    at += size;
  }
  return boxes;
}

function findBox(bytes: Uint8Array, start: number, end: number, type: string) {
  return boxesIn(bytes, start, end).find((box) => box.type === type) ?? null;
}

/** ISO-639-2 packed as three five-bit letters offset from 0x60. */
function mp4Language(bytes: Uint8Array, mdhd: Box) {
  const version = bytes[mdhd.start];
  const offset = mdhd.start + (version === 1 ? 4 + 8 + 8 + 4 + 8 : 4 + 4 + 4 + 4 + 4);
  if (offset + 2 > mdhd.end) return null;
  const packed = big(bytes, offset, 2);
  const letters = [(packed >> 10) & 31, (packed >> 5) & 31, packed & 31]
    .map((value) => String.fromCharCode(value + 0x60))
    .join("");
  return /^[a-z]{3}$/.test(letters) && letters !== "und" ? letters : null;
}

function mp4SubtitleTracks(bytes: Uint8Array, moov: Box): ProbedSubtitle[] {
  const tracks: ProbedSubtitle[] = [];
  for (const trak of boxesIn(bytes, moov.start, moov.end).filter((box) => box.type === "trak")) {
    const mdia = findBox(bytes, trak.start, trak.end, "mdia");
    if (!mdia) continue;
    const hdlr = findBox(bytes, mdia.start, mdia.end, "hdlr");
    if (!hdlr) continue;
    // hdlr payload: version+flags(4), pre_defined(4), handler_type(4).
    const handler = ascii(bytes, hdlr.start + 8, 4);
    if (!MP4_SUBTITLE_HANDLERS.includes(handler)) continue;

    const minf = findBox(bytes, mdia.start, mdia.end, "minf");
    const stbl = minf && findBox(bytes, minf.start, minf.end, "stbl");
    const stsd = stbl && findBox(bytes, stbl.start, stbl.end, "stsd");
    // stsd payload: version+flags(4), entry_count(4), then sample entries.
    const format = stsd && stsd.start + 16 <= stsd.end ? ascii(bytes, stsd.start + 12, 4) : "";
    const known = MP4_CODECS[format];

    const mdhd = findBox(bytes, mdia.start, mdia.end, "mdhd");
    const tkhd = findBox(bytes, trak.start, trak.end, "tkhd");
    const udta = findBox(bytes, trak.start, trak.end, "udta");
    const name = udta && findBox(bytes, udta.start, udta.end, "name");

    tracks.push({
      index: tracks.length,
      streamIndex: tracks.length,
      codec: known?.codec ?? (format || "unknown"),
      language: mdhd ? mp4Language(bytes, mdhd) : null,
      title: name ? ascii(bytes, name.start, name.end - name.start).replace(/\0+$/, "").trim() || null : null,
      textBased: known?.textBased ?? true,
      // tkhd flags: bit 0 enabled, bit 1 in the presentation.
      default: tkhd ? (big(bytes, tkhd.start + 1, 3) & 0x1) === 1 : false,
      forced: false,
    });
  }
  return tracks;
}

/* -------------------------------------------------------------------------- */
/* Matroska / WebM                                                            */
/* -------------------------------------------------------------------------- */

const EBML_HEADER = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const TRACK_TYPE = 0x83;
const CODEC_ID = 0x86;
const LANGUAGE = 0x22b59c;
const LANGUAGE_BCP47 = 0x22b59d;
const TRACK_NAME = 0x536e;
const FLAG_DEFAULT = 0x88;
const FLAG_FORCED = 0x55aa;
const SUBTITLE_TRACK_TYPE = 0x11;

const MATROSKA_CODECS: Record<string, { codec: string; textBased: boolean }> = {
  "S_TEXT/UTF8": { codec: "subrip", textBased: true },
  "S_TEXT/ASCII": { codec: "subrip", textBased: true },
  "S_TEXT/ASS": { codec: "ass", textBased: true },
  "S_TEXT/SSA": { codec: "ssa", textBased: true },
  "S_TEXT/WEBVTT": { codec: "webvtt", textBased: true },
  "S_TEXT/USF": { codec: "text", textBased: true },
  "S_HDMV/PGS": { codec: "hdmv_pgs_subtitle", textBased: false },
  "S_HDMV/TEXTST": { codec: "hdmv_text_subtitle", textBased: true },
  "S_VOBSUB": { codec: "dvd_subtitle", textBased: false },
  "S_DVBSUB": { codec: "dvb_subtitle", textBased: false },
  "S_KATE": { codec: "kate", textBased: false },
};

type Element = { id: number; start: number; end: number; unknownSize: boolean };

/** EBML numbers state their own width in the leading byte. */
function readVint(bytes: Uint8Array, at: number, keepMarker: boolean) {
  if (at >= bytes.length) return null;
  const first = bytes[at];
  if (first === 0) return null;
  let width = 1;
  while (width <= 8 && !(first & (0x80 >> (width - 1)))) width += 1;
  if (width > 8 || at + width > bytes.length) return null;
  let value = keepMarker ? first : first & (0xff >> width);
  let allOnes = (first & (0xff >> width)) === (0xff >> width);
  for (let index = 1; index < width; index += 1) {
    const byte = bytes[at + index];
    if (byte !== 0xff) allOnes = false;
    value = value * 256 + byte;
  }
  return { value, width, allOnes };
}

function readElement(bytes: Uint8Array, at: number): Element | null {
  const id = readVint(bytes, at, true);
  if (!id) return null;
  const size = readVint(bytes, at + id.width, false);
  if (!size) return null;
  const start = at + id.width + size.width;
  return {
    id: id.value,
    start,
    // An unknown size means "runs to the next element at this level"; only
    // Segment and Cluster use it, and neither needs its true end here.
    end: size.allOnes ? bytes.length : start + size.value,
    unknownSize: size.allOnes,
  };
}

function childrenOf(bytes: Uint8Array, element: Element): Element[] {
  const children: Element[] = [];
  let at = element.start;
  const end = Math.min(element.end, bytes.length);
  while (at < end) {
    const child = readElement(bytes, at);
    if (!child || child.end <= child.start) break;
    children.push(child);
    at = child.end;
  }
  return children;
}

function unsigned(bytes: Uint8Array, element: Element) {
  return big(bytes, element.start, Math.min(8, element.end - element.start));
}

function utf8(bytes: Uint8Array, element: Element) {
  return new TextDecoder("utf-8")
    .decode(bytes.subarray(element.start, element.end))
    .replace(/\0+$/, "")
    .trim();
}

function matroskaSubtitleTracks(bytes: Uint8Array, tracks: Element): ProbedSubtitle[] {
  const found: ProbedSubtitle[] = [];
  for (const entry of childrenOf(bytes, tracks).filter((child) => child.id === TRACK_ENTRY)) {
    const fields = childrenOf(bytes, entry);
    const typeField = fields.find((field) => field.id === TRACK_TYPE);
    if (!typeField || unsigned(bytes, typeField) !== SUBTITLE_TRACK_TYPE) continue;

    const codecField = fields.find((field) => field.id === CODEC_ID);
    const codecId = codecField ? utf8(bytes, codecField) : "";
    const known = MATROSKA_CODECS[codecId.toUpperCase()];
    const nameField = fields.find((field) => field.id === TRACK_NAME);
    const languageField = fields.find((field) => field.id === LANGUAGE_BCP47)
      ?? fields.find((field) => field.id === LANGUAGE);
    const defaultField = fields.find((field) => field.id === FLAG_DEFAULT);
    const forcedField = fields.find((field) => field.id === FLAG_FORCED);
    const language = languageField ? utf8(bytes, languageField) : null;

    found.push({
      index: found.length,
      streamIndex: found.length,
      codec: known?.codec ?? (codecId || "unknown"),
      language: language && language !== "und" ? language : null,
      title: nameField ? utf8(bytes, nameField) || null : null,
      textBased: known?.textBased ?? codecId.toUpperCase().startsWith("S_TEXT/"),
      // FlagDefault is absent far more often than it is false, and it defaults to set.
      default: defaultField ? unsigned(bytes, defaultField) === 1 : true,
      forced: forcedField ? unsigned(bytes, forcedField) === 1 : false,
    });
  }
  return found;
}

/* -------------------------------------------------------------------------- */

/**
 * Reads the container index and lists its subtitle tracks.
 *
 * Returns null when the container is not one this understands, which is the
 * signal to fall back to asking FFmpeg rather than to claim there is nothing.
 * An empty array is the opposite: a container that was read and genuinely has
 * no subtitles in it.
 */
export async function sniffSubtitleTracks(read: ByteReader, size: number): Promise<SniffedContainer | null> {
  const head = await read(0, Math.min(size, BOX_HEADER * 4));
  if (head.length < 8) return null;

  // Matroska and WebM both open with the EBML header.
  if (big(head, 0, 4) === EBML_HEADER) {
    const tracks = await matroskaTracksElement(read, size);
    return tracks ? { container: "matroska", tracks } : null;
  }

  // MP4 and QuickTime open with a box. Which box varies more than it looks —
  // ftyp usually, but `free`, `wide` and `skip` padding are all legal first —
  // so the test is whether the box chain leads to a moov, not what it starts with.
  const firstSize = big(head, 0, 4);
  const firstType = ascii(head, 4, 4);
  if (/^[\x20-\x7e]{4}$/.test(firstType) && (firstSize === 0 || firstSize === 1 || (firstSize >= 8 && firstSize <= size))) {
    const moov = await mp4MoovBox(read, size);
    if (moov) return { container: "mp4", tracks: mp4SubtitleTracks(moov.bytes, moov.box) };
  }

  return null;
}

/** Follows top-level box sizes to `moov`, reading only headers on the way. */
async function mp4MoovBox(read: ByteReader, size: number) {
  let at = 0;
  while (at + 8 <= size) {
    const header = await read(at, Math.min(BOX_HEADER, size - at));
    if (header.length < 8) return null;
    let boxSize = big(header, 0, 4);
    const type = ascii(header, 4, 4);
    if (boxSize === 1) {
      if (header.length < 16) return null;
      boxSize = big(header, 8, 8);
    } else if (boxSize === 0) {
      boxSize = size - at;
    }
    if (boxSize < 8) return null;
    if (type === "moov") {
      if (boxSize > MAX_INDEX_BYTES) return null;
      const bytes = await read(at, Math.min(boxSize, size - at));
      const box = boxesIn(bytes, 0, bytes.length).find((candidate) => candidate.type === "moov");
      return box ? { bytes, box } : null;
    }
    at += boxSize;
  }
  return null;
}

/** Follows Segment children to `Tracks`, skipping Clusters by their size. */
async function matroskaTracksElement(read: ByteReader, size: number) {
  const head = await read(0, Math.min(size, 4096));
  const ebml = readElement(head, 0);
  if (!ebml) return null;
  const segment = readElement(head, ebml.end);
  if (!segment || segment.id !== SEGMENT) return null;

  let at = segment.start;
  // Bounded so a file whose Tracks sit behind the media does not walk forever.
  for (let steps = 0; steps < 4096 && at < size; steps += 1) {
    const header = await read(at, Math.min(32, size - at));
    if (header.length < 4) return null;
    const element = readElement(header, 0);
    if (!element || element.unknownSize) return null;
    const length = element.end - element.start;
    const headerLength = element.start;
    if (element.id === TRACKS) {
      if (length > MAX_INDEX_BYTES) return null;
      const bytes = await read(at, Math.min(headerLength + length, size - at));
      const tracks = readElement(bytes, 0);
      return tracks ? matroskaSubtitleTracks(bytes, tracks) : null;
    }
    at += headerLength + length;
  }
  return null;
}

/** Reads a picked file's index without loading the file itself. */
export function fileReader(file: File): ByteReader {
  return async (offset, length) => {
    if (length <= 0) return new Uint8Array(0);
    return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
  };
}
