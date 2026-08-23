/**
 * The shapes the search and editors work with.
 *
 * Carried over from QuoteEngine and cut down to what the studio uses. The
 * archive's versions of these also describe generated media — pre-rendered
 * frame paths, sprite sheets, catalogue manifests — which nothing here has,
 * because every frame is decoded from the opened file on demand.
 */

/** A caption drawn over a frame, positioned as a percentage of the canvas. */
export type TextOverlay = {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
  /** Seconds from the start of the clip; absent means "for the whole clip". */
  start?: number;
  end?: number;
};

/** One subtitle cue, prepared for searching. */
export type Caption = {
  id: number;
  startMs: number;
  endMs: number;
  timestamp: string;
  text: string;
  speaker: string | null;
  /** Normalised text of this cue alone. */
  searchText: string;
  /** This cue plus its immediate neighbours, so a split phrase still matches. */
  searchWindowText?: string;
  /** The moment worth showing for this cue, to a tenth of a second. */
  frameTime?: number;
  frameSecond: number;
};

/** The opened file, dressed up as something the search can rank. */
export type SearchEpisode = {
  id: string;
  season: number;
  episode: number;
  title: string;
  code: string;
  durationSeconds: number;
  width: number;
  height: number;
  captionCount: number;
  captions: Caption[];
};

export type SearchHit = {
  episode: SearchEpisode;
  caption: Caption;
  score: number;
};
