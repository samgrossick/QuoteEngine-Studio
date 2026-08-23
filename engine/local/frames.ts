"use client";

/**
 * Pulls still frames out of a video the browser can already decode.
 *
 * Both decoding paths end up here: the native path points a grabber at the
 * picked file directly, and the FFmpeg path points one at the small proxy clip
 * it transcoded. Seeking and drawing is the same work either way.
 */

/** Object URLs are revoked as they fall out of the cache, so scrubbing cannot leak. */
const DEFAULT_CACHE_LIMIT = 96;

export type FrameGrabber = {
  /** A blob URL for one frame, scaled to `width` and cached by time. */
  frame(time: number, width: number): Promise<string>;
  /** True when a cached frame can be returned without decoding. */
  has(time: number, width: number): boolean;
  release(): void;
};

function frameKey(time: number, width: number) {
  return `${width}@${time.toFixed(2)}`;
}

export function loadedVideo(url: string) {
  return new Promise<HTMLVideoElement>((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    video.onloadeddata = () => resolve(video);
    video.onerror = () => reject(new Error("This video could not be decoded by the browser."));
    video.src = url;
    video.load();
  });
}

export function seekVideo(video: HTMLVideoElement, time: number) {
  return new Promise<void>((resolve, reject) => {
    const target = Math.max(0, Math.min(Number.isFinite(video.duration) ? video.duration - 0.02 : time, time));
    if (Math.abs(video.currentTime - target) < 0.01 && video.readyState >= 2) { resolve(); return; }
    const cleanup = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", failed);
    };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("The video could not be seeked to that moment.")); };
    video.addEventListener("seeked", done, { once: true });
    video.addEventListener("error", failed, { once: true });
    video.currentTime = target;
  });
}

export function canvasBlobUrl(canvas: HTMLCanvasElement, type = "image/jpeg", quality = 0.92) {
  return new Promise<string>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("The frame could not be encoded.")),
    type,
    quality,
  ));
}

export function createFrameGrabber(url: string, limit = DEFAULT_CACHE_LIMIT): FrameGrabber {
  const cache = new Map<string, string>();
  const inFlight = new Map<string, Promise<string>>();
  const canvas = document.createElement("canvas");
  let video: Promise<HTMLVideoElement> | null = null;
  // One element cannot service two seeks at once, so requests take turns.
  let queue: Promise<unknown> = Promise.resolve();
  let released = false;

  function remember(key: string, objectUrl: string) {
    cache.set(key, objectUrl);
    while (cache.size > limit) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      const stale = cache.get(oldest);
      cache.delete(oldest);
      if (stale) URL.revokeObjectURL(stale);
    }
  }

  async function draw(time: number, width: number) {
    video ??= loadedVideo(url);
    const element = await video;
    await seekVideo(element, time);
    // Never ask for more pixels than the file holds; upscaling only costs bytes.
    const target = Math.min(width, element.videoWidth || width);
    const scale = target / (element.videoWidth || target);
    canvas.width = target;
    // Even heights keep the result compatible with the GIF and video encoders.
    canvas.height = Math.max(2, Math.round((element.videoHeight || width) * scale / 2) * 2);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    return canvasBlobUrl(canvas);
  }

  return {
    has: (time, width) => cache.has(frameKey(time, width)),
    frame(time, width) {
      const key = frameKey(time, width);
      const cached = cache.get(key);
      if (cached) return Promise.resolve(cached);
      const existing = inFlight.get(key);
      if (existing) return existing;
      const request = (queue = queue.then(() => draw(time, width), () => draw(time, width)))
        .then((objectUrl) => {
          // A release while this was queued means the caller has moved on.
          if (released) { URL.revokeObjectURL(objectUrl); return objectUrl; }
          remember(key, objectUrl);
          return objectUrl;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, request);
      return request;
    },
    release() {
      released = true;
      for (const objectUrl of cache.values()) URL.revokeObjectURL(objectUrl);
      cache.clear();
      void video?.then((element) => {
        element.removeAttribute("src");
        element.load();
      }).catch(() => undefined);
      video = null;
    },
  };
}
