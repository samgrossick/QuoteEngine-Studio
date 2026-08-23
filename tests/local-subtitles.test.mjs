import assert from "node:assert/strict";
import test from "node:test";
import { decodeSubtitleBytes, detectSubtitleFormat, parseSubtitles, parseTimestamp } from "../engine/local/subtitles.ts";
import { parseFfmpegBanner, preferredSubtitle, subtitleTrackLabel } from "../engine/local/probe.ts";
import { normalizeSearchText, searchCatalog } from "../engine/search.ts";
import { localCaptions, localProgramme, localSearchEpisode, programmeNumberFrom, programmeTitleFrom } from "../engine/local/catalog.ts";

const SRT = `1
00:00:01,000 --> 00:00:03,500
JACK: Aye, that's <i>him</i>.

2
00:00:04,000 --> 00:00:06,000
Away an' bile
yer heid.

3
00:00:07,000 --> 00:00:07,000
`;

const VTT = `WEBVTT

NOTE this is a comment

intro
00:00:01.000 --> 00:00:03.500 line:90% align:middle
<v Victor>Get us a pie.

00:04.000 --> 00:06.000
Nae bother.
`;

// String.raw keeps the backslashes an .ass file actually contains.
const ASS = String.raw`[Script Info]
ScriptType: v4.00+

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.50,Default,Winston,0,0,0,,{\pos(190,270)}Right,\Nwho's next?
Dialogue: 0,0:00:04.00,0:00:06.00,Sign,,0,0,0,,{\an8}
Dialogue: 0,0:00:07.00,0:00:09.00,Default,,0,0,0,,A line, with a comma.
`;

test("SRT cues lose markup, keep speakers, and drop zero-length blocks", () => {
  const cues = parseSubtitles(SRT, "srt");

  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, "JACK: Aye, that's him.");
  assert.equal(cues[0].speaker, "JACK");
  assert.equal(cues[0].timestamp, "00:00:01");
  assert.equal(cues[1].text, "Away an' bile yer heid.");
  assert.equal(cues[1].speaker, null);
});

test("a cue's frame time is its midpoint, to a tenth of a second", () => {
  const [first] = parseSubtitles(SRT, "srt");

  assert.equal(first.frameTime, 2.3);
});

test("WebVTT cue settings, voice spans, and bare MM:SS stamps all parse", () => {
  const cues = parseSubtitles(VTT, "vtt");

  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, "Get us a pie.");
  assert.equal(cues[0].speaker, "Victor");
  assert.equal(cues[1].startMs, 4000);
});

test("ASS dialogue survives override blocks, line breaks, and commas in the text", () => {
  const cues = parseSubtitles(ASS, "ass");

  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, "Right, who's next?");
  assert.equal(cues[0].speaker, "Winston");
  assert.equal(cues[1].text, "A line, with a comma.");
});

test("an offset shifts every cue and never produces a negative start", () => {
  const cues = parseSubtitles(SRT, "srt", -2500);

  assert.equal(cues[0].startMs, 0);
  assert.equal(cues[1].startMs, 1500);
});

test("format detection prefers the extension and falls back to the content", () => {
  assert.equal(detectSubtitleFormat("episode.SRT", SRT), "srt");
  assert.equal(detectSubtitleFormat("episode.ssa", ASS), "ass");
  assert.equal(detectSubtitleFormat("track", VTT), "vtt");
  assert.equal(detectSubtitleFormat("track", ASS), "ass");
  assert.equal(detectSubtitleFormat("notes.txt", "just prose"), null);
});

test("ASS centiseconds and SRT milliseconds both reach the same instant", () => {
  assert.equal(parseTimestamp("0:00:03.50"), 3500);
  assert.equal(parseTimestamp("00:00:03,500"), 3500);
  assert.equal(parseTimestamp("nonsense"), null);
});

const BANNER = `Input #0, matroska,webm, from '/mount/episode.mkv':
  Metadata:
    title           : Still Game
  Duration: 00:28:44.06, start: 0.000000, bitrate: 2531 kb/s
  Stream #0:0(eng): Video: h264 (High), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 25 fps, 25 tbr, 1k tbn (default)
    Side data:
      displaymatrix: rotation of -90.00 degrees
  Stream #0:1(eng): Audio: aac (LC), 48000 Hz, stereo, fltp (default)
  Stream #0:2(eng): Subtitle: subrip (default)
    Metadata:
      title           : English SDH
  Stream #0:3(fre): Subtitle: ass (forced)
  Stream #0:4: Subtitle: hdmv_pgs_subtitle
`;

test("the FFmpeg banner yields duration, the first video stream, and every subtitle track", () => {
  const probe = parseFfmpegBanner(BANNER);

  assert.equal(probe.durationSeconds, 1724.06);
  assert.deepEqual(probe.video, { width: 1920, height: 1080, frameRate: 25, codec: "h264", rotation: 270 });
  assert.equal(probe.subtitles.length, 3);
  assert.deepEqual(probe.subtitles.map((track) => track.index), [0, 1, 2]);
  assert.deepEqual(probe.subtitles.map((track) => track.streamIndex), [2, 3, 4]);
});

test("a track's title comes from its own metadata block, not the next stream's", () => {
  const [subrip, ass] = parseFfmpegBanner(BANNER).subtitles;

  assert.equal(subrip.title, "English SDH");
  assert.equal(subrip.language, "eng");
  assert.equal(ass.title, null);
  assert.equal(subtitleTrackLabel(subrip), "English SDH · ENG (default)");
});

test("image subtitles are flagged so the studio can refuse them instead of failing", () => {
  const tracks = parseFfmpegBanner(BANNER).subtitles;

  assert.deepEqual(tracks.map((track) => track.textBased), [true, true, false]);
  assert.match(subtitleTrackLabel(tracks[2]), /image/);
});

test("the preferred track is the default text one, never a forced or image track", () => {
  const tracks = parseFfmpegBanner(BANNER).subtitles;

  assert.equal(preferredSubtitle(tracks)?.index, 0);
  assert.equal(preferredSubtitle(tracks.slice(1))?.index, 1);
  assert.equal(preferredSubtitle(tracks.slice(2)), null);
});

test("a file with no streams at all degrades to zeroes rather than throwing", () => {
  const probe = parseFfmpegBanner("Invalid data found when processing input");

  assert.equal(probe.durationSeconds, 0);
  assert.equal(probe.video, null);
  assert.deepEqual(probe.subtitles, []);
});


const SPLIT_PHRASE = `1
00:00:10,000 --> 00:00:11,000
Steamed

2
00:00:11,000 --> 00:00:12,000
hams.

3
00:05:00,000 --> 00:05:02,000
Nothing to do with it.
`;

function localEpisodeFrom(source, fileName) {
  const captions = localCaptions(parseSubtitles(source, "srt"), (value) => normalizeSearchText(value));
  return localSearchEpisode(localProgramme(fileName, 1800, 1920, 1080, captions));
}

test("a locally opened file is searchable by the archive's own ranking", () => {
  const episode = localEpisodeFrom(SPLIT_PHRASE, "Some.Show.S02E05.mkv");

  const hits = searchCatalog([episode], "steamed hams");

  assert.equal(hits.length, 1);
  assert.equal(hits[0].caption.id, 1);
});

test("the three-cue window is what lets a split phrase match at all", () => {
  const [first] = localCaptions(parseSubtitles(SPLIT_PHRASE, "srt"), (value) => normalizeSearchText(value));

  assert.equal(first.searchText, "steamed");
  assert.equal(first.searchWindowText, "steamed hams");
});

test("unrelated dialogue elsewhere in the file is not dragged into the result", () => {
  const episode = localEpisodeFrom(SPLIT_PHRASE, "Some.Show.S02E05.mkv");

  assert.equal(searchCatalog([episode], "steamed hams").length, 1);
  assert.equal(searchCatalog([episode], "nothing").length, 1);
  assert.equal(searchCatalog([episode], "aubergine").length, 0);
});

test("a file name supplies a readable title and its numbering when it has any", () => {
  assert.equal(programmeTitleFrom("Still.Game.S01E01.1080p.WEB.mkv"), "Still Game S01E01 1080p WEB");
  assert.deepEqual(programmeNumberFrom("Still.Game.S01E01.1080p.mkv"), { season: 1, episode: 1 });
  assert.deepEqual(programmeNumberFrom("show 2x11 finale.mp4"), { season: 2, episode: 11 });
  assert.equal(programmeNumberFrom("holiday video.mp4"), null);
});

test("a file with no numbering still opens, labelled as local", () => {
  const episode = localEpisodeFrom(SPLIT_PHRASE, "holiday video.mp4");

  assert.equal(episode.code, "LOCAL");
  assert.equal(episode.title, "holiday video");
  assert.equal(episode.captionCount, 3);
});

test("legacy subtitle bytes decode as Windows-1252 rather than mojibake", () => {
  assert.equal(decodeSubtitleBytes(new TextEncoder().encode("café")), "café");
  assert.equal(decodeSubtitleBytes(new Uint8Array([0x63, 0x61, 0x66, 0xe9])), "café");
});
