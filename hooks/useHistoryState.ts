"use client";

import { useCallback, useRef, useState } from "react";

type History<T> = { past: T[]; present: T; future: T[] };

export function useHistoryState<T>(initial: T) {
  const [state, setState] = useState<History<T>>({ past: [], present: initial, future: [] });
  const transaction = useRef<T | null>(null);
  const commit = useCallback((next: T | ((current: T) => T)) => setState((current) => {
    const present = typeof next === "function" ? (next as (value: T) => T)(current.present) : next;
    return Object.is(current.present, present) ? current : { past: [...current.past, current.present], present, future: [] };
  }), []);
  const undo = useCallback(() => setState((current) => current.past.length ? {
    past: current.past.slice(0, -1), present: current.past[current.past.length - 1], future: [current.present, ...current.future],
  } : current), []);
  const redo = useCallback(() => setState((current) => current.future.length ? {
    past: [...current.past, current.present], present: current.future[0], future: current.future.slice(1),
  } : current), []);
  const reset = useCallback((present: T) => setState({ past: [], present, future: [] }), []);
  const begin = useCallback(() => setState((current) => {
    transaction.current = current.present;
    return current;
  }), []);
  const preview = useCallback((next: T | ((current: T) => T)) => setState((current) => ({
    ...current,
    present: typeof next === "function" ? (next as (value: T) => T)(current.present) : next,
    future: [],
  })), []);
  const end = useCallback(() => setState((current) => {
    const before = transaction.current;
    transaction.current = null;
    if (before === null || Object.is(before, current.present)) return current;
    return { past: [...current.past, before], present: current.present, future: [] };
  }), []);
  return { value: state.present, commit, undo, redo, reset, begin, preview, end, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
