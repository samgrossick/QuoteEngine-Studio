"use client";

/**
 * The FFmpeg fallback.
 *
 * Browsers cannot demux Matroska and cannot see a subtitle track inside any
 * container, so anything the `<video>` element refuses is handed to FFmpeg
 * compiled to WebAssembly instead.
 *
 * Two decisions keep this honest:
 *
 *  - the core is served from this origin, not a CDN, so opening a file makes no
 *    third-party request, and
 *  - the file is *mounted* through WORKERFS rather than copied in, so a 4 GB
 *    MKV is read lazily off disk instead of being loaded into wasm memory.
 *
 * The single-threaded core is deliberate: the multi-threaded one needs
 * SharedArrayBuffer, which would force every deployment to serve COOP/COEP
 * headers. Nothing here is uploaded either way.
 */

import type { FFmpeg } from "@ffmpeg/ffmpeg";

/** Where the small worker modules are served from, relative to the page. */
export const FFMPEG_ASSET_BASE = "ffmpeg";

/**
 * Where the 32 MB core is fetched from.
 *
 * A public CDN by default, so hosting the studio costs almost no bandwidth.
 * That is a deliberate trade: the picked file still never leaves the device,
 * but fetching the decoder is a request to a third party, which sees the
 * visitor's IP the way any other asset request would. Pinned to an exact
 * version so the bytes cannot change underneath the page.
 *
 * Pass a path of your own to `setFFmpegCoreBase` to serve it yourself instead.
 */
export const DEFAULT_CORE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

let coreBase = DEFAULT_CORE_BASE;

export function setFFmpegCoreBase(base: string) {
  coreBase = base.replace(/\/+$/, "");
}

const MOUNT_POINT = "/media";

export type FFmpegProgress = (ratio: number) => void;

export class FFmpegUnavailableError extends Error {
  constructor() {
    super(
      "The FFmpeg worker is missing from this site. Run `npm run ffmpeg-worker` to copy it into public/ffmpeg, " +
      "or supply a video the browser can play with a separate subtitle file instead.",
    );
    this.name = "FFmpegUnavailableError";
  }
}

export type LocalFFmpeg = {
  /** Runs one FFmpeg invocation and resolves with everything it logged. */
  exec(args: string[], onProgress?: FFmpegProgress): Promise<string>;
  read(path: string): Promise<Uint8Array<ArrayBuffer>>;
  remove(path: string): Promise<void>;
  /** Mounts a picked file and returns the path FFmpeg should read. */
  mountFile(file: File): Promise<string>;
  unmountFile(): Promise<void>;
};

let pending: Promise<LocalFFmpeg> | null = null;

function assetUrl(name: string) {
  // Resolved against the document, not the origin root, so the studio still
  // finds its engine when the built folder is served from a subdirectory.
  return new URL(`${FFMPEG_ASSET_BASE}/${name}`, document.baseURI).href;
}

/**
 * Fails fast with an explanation rather than letting the engine stall on a 404
 * page it would try to run as a script.
 *
 * Only the worker is checked, because only the worker has to be served by this
 * site. It also has to be same-origin: a module worker cannot be constructed
 * from another origin however permissive that origin's CORS headers are, which
 * is why the small part stays here and only the large part goes to the CDN.
 */
async function assertWorkerPresent() {
  let response: Response;
  try {
    response = await fetch(assetUrl("worker/worker.js"), { method: "HEAD" });
  } catch {
    throw new FFmpegUnavailableError();
  }
  // Only a 404 means the copy step never ran. Hosts that answer HEAD with 405,
  // or anything else odd, are left to the worker rather than refused here.
  if (response.status === 404) throw new FFmpegUnavailableError();
}

async function create(onStatus?: (message: string) => void): Promise<LocalFFmpeg> {
  await assertWorkerPresent();
  // Imported here rather than at module scope: the package resolves to an empty
  // stub under Node, so a static import would break server rendering.
  const { FFmpeg, FFFSType } = await import("@ffmpeg/ffmpeg");
  const ffmpeg: FFmpeg = new FFmpeg();

  let captured: string[] = [];
  ffmpeg.on("log", ({ message }) => {
    captured.push(message);
    onStatus?.(message);
  });

  let reportProgress: FFmpegProgress | null = null;
  ffmpeg.on("progress", ({ progress }) => reportProgress?.(Math.max(0, Math.min(1, progress))));

  await ffmpeg.load({
    // Same-origin and served as a static file: a module worker cannot be built
    // from another origin, and one resolved out of a pre-bundled dependency
    // gets the dev client injected into it and dies on `window is not defined`.
    classWorkerURL: assetUrl("worker/worker.js"),
    // The worker imports these across origins, which the CDN's CORS headers allow.
    coreURL: `${coreBase}/ffmpeg-core.js`,
    wasmURL: `${coreBase}/ffmpeg-core.wasm`,
  });

  // One wasm instance, one job at a time. Callers fire overlapping requests as
  // the viewer scrubs, and FFmpeg has no notion of concurrent invocations.
  let queue: Promise<unknown> = Promise.resolve();
  function serialise<T>(job: () => Promise<T>): Promise<T> {
    const result = queue.then(job, job);
    queue = result.catch(() => undefined);
    return result;
  }

  let mounted = false;

  return {
    exec: (args, onProgress) => serialise(async () => {
      captured = [];
      reportProgress = onProgress ?? null;
      try {
        await ffmpeg.exec(args);
      } finally {
        reportProgress = null;
      }
      // The exit code is not checked: probing runs `-i` with no output, which
      // FFmpeg always reports as a failure even though the banner is what we want.
      return captured.join("\n");
    }),
    read: (path) => serialise(async () => {
      const data = await ffmpeg.readFile(path);
      if (typeof data === "string") throw new Error(`Expected binary data from ${path}.`);
      // The single-threaded core never hands back SharedArrayBuffer-backed
      // views, so this is safe to hand straight to Blob and TextDecoder.
      return data as Uint8Array<ArrayBuffer>;
    }),
    remove: (path) => serialise(async () => {
      await ffmpeg.deleteFile(path).catch(() => undefined);
    }),
    mountFile: (file) => serialise(async () => {
      if (mounted) {
        await ffmpeg.unmount(MOUNT_POINT).catch(() => undefined);
        mounted = false;
      }
      await ffmpeg.createDir(MOUNT_POINT).catch(() => undefined);
      await ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, MOUNT_POINT);
      mounted = true;
      return `${MOUNT_POINT}/${file.name}`;
    }),
    unmountFile: () => serialise(async () => {
      if (!mounted) return;
      await ffmpeg.unmount(MOUNT_POINT).catch(() => undefined);
      mounted = false;
    }),
  };
}

/** Loads the engine once per tab and shares it between every local source. */
export function loadFFmpeg(onStatus?: (message: string) => void) {
  if (!pending) {
    pending = create(onStatus).catch((error: unknown) => {
      pending = null;
      throw error;
    });
  }
  return pending;
}

export function ffmpegLoaded() {
  return pending !== null;
}
