/**
 * Adapts one locally opened file to the shapes the engine already searches.
 *
 * `searchCatalog` ranks phrases across neighbouring cues, deduplicates nearby
 * scenes and honours the show's aliases. None of that should be rewritten for
 * local files, so a picked video is dressed up as a one-episode catalogue and
 * handed to the same function the archive uses.
 *
 * Only types are imported, so this module also loads under `node --test`.
 * The normaliser arrives as an argument because it is locale-aware and the
 * locale belongs to the show, not to the file.
 */

import type { Caption, SearchEpisode } from "../types";
import type { SubtitleCue } from "./subtitles";

export const LOCAL_SHOW_ID = "local";

export type LocalProgramme = {
  id: string;
  title: string;
  code: string;
  season: number;
  episode: number;
  durationSeconds: number;
  width: number;
  height: number;
  captions: Caption[];
};

/** `Some.Programme.S02E05.1080p.mkv` reads better as `Some Programme S02E05 1080p`. */
export function programmeTitleFrom(fileName: string) {
  const withoutExtension = fileName.replace(/\.[a-z0-9]{2,4}$/i, "");
  const spaced = withoutExtension.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  return spaced || fileName || "Untitled";
}

/** Finds `S01E02`, `1x02` or `102` style numbering, if the name carries any. */
export function programmeNumberFrom(fileName: string) {
  const tagged = fileName.match(/[Ss](\d{1,2})[\s._-]*[Ee](\d{1,3})/);
  if (tagged) return { season: Number(tagged[1]), episode: Number(tagged[2]) };
  const crossed = fileName.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  if (crossed) return { season: Number(crossed[1]), episode: Number(crossed[2]) };
  return null;
}

export function programmeCode(season: number, episode: number) {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

/**
 * How far apart two cues may be and still count as the same breath. A phrase
 * split over a line break has no real gap; the next line five minutes later is
 * a different scene, and folding it into the window would invent phrases that
 * were never said and scatter the results.
 */
const WINDOW_GAP_MS = 2000;

function adjacent(cue: SubtitleCue | undefined, neighbour: SubtitleCue | undefined) {
  if (!cue || !neighbour) return false;
  const gap = neighbour.startMs >= cue.endMs ? neighbour.startMs - cue.endMs : cue.startMs - neighbour.endMs;
  return gap <= WINDOW_GAP_MS;
}

/**
 * Turns cues into captions, including the three-cue window that lets a search
 * match a phrase which straddles a line break.
 */
export function localCaptions(cues: SubtitleCue[], normalise: (value: string) => string): Caption[] {
  const searchTexts = cues.map((cue) => normalise(cue.text));
  return cues.map((cue, index) => ({
    id: cue.id,
    startMs: cue.startMs,
    endMs: cue.endMs,
    timestamp: cue.timestamp,
    text: cue.text,
    speaker: cue.speaker,
    searchText: searchTexts[index],
    searchWindowText: [
      adjacent(cue, cues[index - 1]) ? searchTexts[index - 1] : "",
      searchTexts[index],
      adjacent(cue, cues[index + 1]) ? searchTexts[index + 1] : "",
    ]
      .filter(Boolean)
      .join(" "),
    frameTime: cue.frameTime,
    frameSecond: Math.floor(cue.frameTime),
  }));
}

export function localProgramme(
  fileName: string,
  durationSeconds: number,
  width: number,
  height: number,
  captions: Caption[],
): LocalProgramme {
  const numbering = programmeNumberFrom(fileName);
  const season = numbering?.season ?? 1;
  const episode = numbering?.episode ?? 1;
  return {
    id: LOCAL_SHOW_ID,
    title: programmeTitleFrom(fileName),
    code: numbering ? programmeCode(season, episode) : "LOCAL",
    season,
    episode,
    durationSeconds,
    width,
    height,
    captions,
  };
}

/** Dresses the opened file as the one episode of a one-episode catalogue. */
export function localSearchEpisode(programme: LocalProgramme): SearchEpisode {
  return {
    id: programme.id,
    season: programme.season,
    episode: programme.episode,
    title: programme.title,
    code: programme.code,
    durationSeconds: programme.durationSeconds,
    width: programme.width,
    height: programme.height,
    captionCount: programme.captions.length,
    captions: programme.captions,
  };
}
