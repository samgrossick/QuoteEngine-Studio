/**
 * Settings for the standalone studio.
 *
 * The archive takes these from its show package, because a show decides how its
 * own media is rendered. The studio has no show: it is handed one file by one
 * person, so it carries its own defaults and never imports `show/`.
 */

export type StudioConfig = {
  name: string;
  tagline: string;
  locale: string;
  searchPlaceholder: string;
  media: {
    /** Width of the working copy used for previews, GIFs and video. */
    motionWidth: number;
    /** Frames per second for exported GIFs and video. */
    motionFps: number;
    /** Longest clip the GIF editor will trim to. */
    maxGifSeconds: number;
  };
  /** Spellings that should find each other. Empty by default; a fork can fill it. */
  searchAliases: Record<string, string[]>;
};

export const studioConfig: StudioConfig = {
  name: "QuoteEngine Studio",
  tagline: "Memes and GIFs from a file on your own device",
  locale: "en-GB",
  searchPlaceholder: "Search the dialogue…",
  media: {
    motionWidth: 480,
    motionFps: 12,
    maxGifSeconds: 10,
  },
  searchAliases: {},
};
