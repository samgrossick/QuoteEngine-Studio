#!/usr/bin/env node
/**
 * Copies the FFmpeg worker modules into public/ffmpeg/worker.
 *
 * Only three small files, totalling about six kilobytes. The 32 MB core they
 * load is fetched from a CDN at run time instead, so it is neither installed
 * nor served by this site.
 *
 * The worker cannot go to the CDN with it: a module worker can only be
 * constructed from a same-origin URL, however permissive the other origin's
 * CORS headers are. It also has to be a plain static file rather than a
 * bundled one — left to the bundler, `new Worker(new URL(...))` inside a
 * pre-bundled dependency gets rewritten and the dev-server client injected
 * into it, which throws `window is not defined` the moment the worker starts.
 */

import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, "node_modules", "@ffmpeg", "ffmpeg", "dist", "esm");
const to = join(root, "public", "ffmpeg", "worker");
// worker.js imports the other two by relative path, so they travel together.
const files = ["worker.js", "const.js", "errors.js"];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

if (!await exists(from)) {
  // Not fatal. Without the worker the studio still opens anything the browser
  // can decode, which is most things, using a subtitle file for the words.
  console.warn("@ffmpeg/ffmpeg is not installed, so public/ffmpeg/worker was left empty.");
  console.warn("The studio will still open whatever the browser can decode.");
  process.exit(0);
}

await mkdir(to, { recursive: true });
for (const file of files) {
  const source = await stat(join(from, file));
  const existing = await stat(join(to, file)).catch(() => null);
  if (existing?.size === source.size && existing.mtimeMs >= source.mtimeMs) continue;
  await copyFile(join(from, file), join(to, file));
  console.log(`public/ffmpeg/worker/${file} (${(source.size / 1024).toFixed(1)} KB)`);
}
