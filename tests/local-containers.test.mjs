import assert from "node:assert/strict";
import test from "node:test";
import { fileReader, sniffSubtitleTracks } from "../engine/local/containers.ts";

/** Serves a whole container from memory, the way File.slice serves one from disk. */
function readerFor(bytes) {
  return [(offset, length) => Promise.resolve(bytes.subarray(offset, offset + length)), bytes.length];
}

const concat = (...parts) => {
  const flat = parts.flatMap((part) => Array.isArray(part) ? part : [...part]);
  return Uint8Array.from(flat);
};
const text = (value) => [...Buffer.from(value, "utf8")];
const be = (value, width) => Array.from({ length: width }, (_, i) => (value >> ((width - 1 - i) * 8)) & 0xff);

/* -- MP4 ------------------------------------------------------------------- */

function box(type, ...payload) {
  const body = concat(...payload);
  return concat(be(body.length + 8, 4), text(type), body);
}

const TX3G_TRACK = box("trak",
  // tkhd: version(1) + flags(3); flag 0x1 marks the track enabled.
  box("tkhd", [0, 0, 0, 1], be(0, 80)),
  box("mdia",
    // mdhd v0: version+flags, creation, modification, timescale, duration, language.
    box("mdhd", be(0, 4), be(0, 4), be(0, 4), be(1000, 4), be(0, 4), be(0x15c7, 2), be(0, 2)),
    // hdlr: version+flags, pre_defined, handler_type.
    box("hdlr", be(0, 4), be(0, 4), text("sbtl"), be(0, 12)),
    box("minf", box("stbl",
      // stsd: version+flags, entry_count, then the sample entry itself.
      box("stsd", be(0, 4), be(1, 4), box("tx3g", be(0, 8))),
    )),
  ),
  box("udta", box("name", text("English SDH"))),
);

const PGS_TRACK = box("trak",
  box("tkhd", [0, 0, 0, 0], be(0, 80)),
  box("mdia",
    box("mdhd", be(0, 4), be(0, 4), be(0, 4), be(1000, 4), be(0, 4), be(0x15c7, 2), be(0, 2)),
    box("hdlr", be(0, 4), be(0, 4), text("subp"), be(0, 12)),
    box("minf", box("stbl", box("stsd", be(0, 4), be(1, 4), box("mp4s", be(0, 8))))),
  ),
);

const VIDEO_TRACK = box("trak",
  box("tkhd", [0, 0, 0, 1], be(0, 80)),
  box("mdia", box("hdlr", be(0, 4), be(0, 4), text("vide"), be(0, 12))),
);

test("an MP4 index yields its text and image subtitle tracks in file order", async () => {
  const mp4 = concat(box("ftyp", text("isom"), be(0, 8)), box("moov", VIDEO_TRACK, TX3G_TRACK, PGS_TRACK));

  const result = await sniffSubtitleTracks(...readerFor(mp4));

  assert.equal(result?.container, "mp4");
  assert.equal(result.tracks.length, 2);
  assert.deepEqual(result.tracks.map((track) => track.codec), ["mov_text", "dvd_subtitle"]);
  assert.deepEqual(result.tracks.map((track) => track.textBased), [true, false]);
  assert.deepEqual(result.tracks.map((track) => track.index), [0, 1]);
});

test("an MP4 subtitle track keeps its language, title and enabled flag", async () => {
  const mp4 = concat(box("ftyp", text("isom"), be(0, 8)), box("moov", TX3G_TRACK));

  const [track] = (await sniffSubtitleTracks(...readerFor(mp4))).tracks;

  assert.equal(track.language, "eng");
  assert.equal(track.title, "English SDH");
  assert.equal(track.default, true);
});

test("moov is found by following box sizes, even behind a huge mdat", async () => {
  // A non-faststart file puts the media first. Only headers should be read.
  const mdat = box("mdat", be(0, 4096));
  const mp4 = concat(box("ftyp", text("isom"), be(0, 8)), mdat, box("moov", TX3G_TRACK));
  let bytesRead = 0;
  const [read, size] = readerFor(mp4);

  const result = await sniffSubtitleTracks((offset, length) => {
    bytesRead += length;
    return read(offset, length);
  }, size);

  assert.equal(result.tracks.length, 1);
  assert.ok(bytesRead < mdat.length, `read ${bytesRead} bytes, should have skipped the ${mdat.length}-byte mdat`);
});

test("an MP4 is recognised by its box chain, not by starting with ftyp", async () => {
  // `free` and `wide` padding before ftyp is legal and common enough to matter.
  const mp4 = concat(box("free", be(0, 64)), box("wide", be(0, 8)), box("ftyp", text("isom"), be(0, 8)), box("moov", TX3G_TRACK));

  const result = await sniffSubtitleTracks(...readerFor(mp4));

  assert.equal(result?.container, "mp4");
  assert.equal(result.tracks.length, 1);
});

test("an MP4 with no subtitle handler reports an empty list, not an unknown container", async () => {
  const mp4 = concat(box("ftyp", text("isom"), be(0, 8)), box("moov", VIDEO_TRACK));

  const result = await sniffSubtitleTracks(...readerFor(mp4));

  assert.equal(result.container, "mp4");
  assert.deepEqual(result.tracks, []);
});

/* -- Matroska -------------------------------------------------------------- */

/** EBML sizes carry their own width in the leading byte. */
function vint(value) {
  if (value < 0x7f) return [0x80 | value];
  if (value < 0x3fff) return [0x40 | (value >> 8), value & 0xff];
  return [0x20 | (value >> 16), (value >> 8) & 0xff, value & 0xff];
}

function element(id, ...payload) {
  const body = concat(...payload);
  return concat(id, vint(body.length), body);
}

const ID = {
  ebml: [0x1a, 0x45, 0xdf, 0xa3],
  segment: [0x18, 0x53, 0x80, 0x67],
  tracks: [0x16, 0x54, 0xae, 0x6b],
  cluster: [0x1f, 0x43, 0xb6, 0x75],
  entry: [0xae],
  type: [0x83],
  codec: [0x86],
  language: [0x22, 0xb5, 0x9c],
  name: [0x53, 0x6e],
  flagDefault: [0x88],
  flagForced: [0x55, 0xaa],
};

const SUBRIP_ENTRY = element(ID.entry,
  element(ID.type, [0x11]),
  element(ID.codec, text("S_TEXT/UTF8")),
  element(ID.language, text("eng")),
  element(ID.name, text("English")),
  element(ID.flagDefault, [1]),
);

const PGS_ENTRY = element(ID.entry,
  element(ID.type, [0x11]),
  element(ID.codec, text("S_HDMV/PGS")),
  element(ID.flagForced, [1]),
);

const VIDEO_ENTRY = element(ID.entry, element(ID.type, [0x01]), element(ID.codec, text("V_MPEG4/ISO/AVC")));

function matroska(...segmentChildren) {
  return concat(element(ID.ebml, be(0, 8)), element(ID.segment, ...segmentChildren));
}

test("a Matroska index yields its subtitle tracks and skips the video track", async () => {
  const result = await sniffSubtitleTracks(...readerFor(matroska(element(ID.tracks, VIDEO_ENTRY, SUBRIP_ENTRY, PGS_ENTRY))));

  assert.equal(result?.container, "matroska");
  assert.deepEqual(result.tracks.map((track) => track.codec), ["subrip", "hdmv_pgs_subtitle"]);
  assert.deepEqual(result.tracks.map((track) => track.textBased), [true, false]);
});

test("a Matroska subtitle track keeps its language, name and flags", async () => {
  const result = await sniffSubtitleTracks(...readerFor(matroska(element(ID.tracks, SUBRIP_ENTRY, PGS_ENTRY))));
  const [subrip, pgs] = result.tracks;

  assert.equal(subrip.language, "eng");
  assert.equal(subrip.title, "English");
  assert.equal(subrip.default, true);
  assert.equal(subrip.forced, false);
  assert.equal(pgs.forced, true);
  // FlagDefault is absent far more often than it is false, and defaults to set.
  assert.equal(pgs.default, true);
});

test("Tracks is found by stepping over Clusters rather than reading them", async () => {
  // Comfortably larger than the header window, so skipping is what is measured.
  const cluster = element(ID.cluster, new Uint8Array(400_000));
  const bytes = matroska(cluster, element(ID.tracks, SUBRIP_ENTRY));
  let bytesRead = 0;
  const [read, size] = readerFor(bytes);

  const result = await sniffSubtitleTracks((offset, length) => {
    bytesRead += length;
    return read(offset, length);
  }, size);

  assert.equal(result.tracks.length, 1);
  // What matters is that the media itself is never read, however big it is.
  assert.ok(bytesRead < 8192, `read ${bytesRead} bytes of a ${bytes.length}-byte file`);
});

test("a Matroska file with no subtitle tracks reports an empty list", async () => {
  const result = await sniffSubtitleTracks(...readerFor(matroska(element(ID.tracks, VIDEO_ENTRY))));

  assert.equal(result.container, "matroska");
  assert.deepEqual(result.tracks, []);
});

/* -- Anything else --------------------------------------------------------- */

test("an unrecognised container returns null, which means ask FFmpeg", async () => {
  // Null and [] must stay distinct: one is "do not know", the other is "none".
  const avi = concat(text("RIFF"), be(2048, 4), text("AVI LIST"));

  assert.equal(await sniffSubtitleTracks(...readerFor(avi)), null);
  assert.equal(await sniffSubtitleTracks(...readerFor(Uint8Array.from([1, 2, 3]))), null);
});

test("a truncated file gives up instead of inventing tracks", async () => {
  const truncated = concat(box("ftyp", text("isom"), be(0, 8))).subarray(0, 10);

  assert.equal(await sniffSubtitleTracks(...readerFor(truncated)), null);
});

test("fileReader slices rather than loading the file", async () => {
  const blob = new Blob([Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])]);
  const file = Object.assign(blob, { name: "x.mkv" });

  const read = fileReader(file);

  assert.deepEqual([...await read(2, 3)], [3, 4, 5]);
  assert.deepEqual([...await read(0, 0)], []);
});
