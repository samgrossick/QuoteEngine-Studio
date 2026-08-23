/**
 * Reading times off captions and showing them to people.
 *
 * Carried over from QuoteEngine, minus everything that resolves generated
 * media paths: the studio has no pre-rendered frames, sprite sheets or
 * previews to point at.
 */

import type { Caption } from "./types";

/** The moment worth showing for a cue: its midpoint, or failing that its second. */
export function captionTime(caption: Caption) {
  return caption.frameTime ?? caption.frameSecond;
}

export function formatTime(seconds: number) {
  seconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? [hours, minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":")
    : [minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":");
}
