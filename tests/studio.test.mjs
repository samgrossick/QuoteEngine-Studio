import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

/**
 * The comments in these files explain what the code deliberately avoids, so
 * they name the very things these tests forbid. Only the code is checked.
 */
function codeOnly(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const SKIP = new Set(["node_modules", "dist", "public", "tests", ".github", ".git"]);

/** Every source file in the app, wherever it lives. */
async function studioSources(directory = "") {
  const files = [];
  for (const entry of await readdir(new URL(`../${directory}`, import.meta.url), { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await studioSources(path));
    else if (/\.tsx?$/.test(entry.name)) files.push([path, await source(path)]);
  }
  return files;
}

/* -- Standalone ------------------------------------------------------------ */

test("the studio builds as a static single-page site", async () => {
  const config = await source("vite.config.ts");
  const pkg = JSON.parse(await source("package.json"));

  // Relative asset URLs, so a project site served from /repository-name/ works.
  assert.match(config, /base: "\.\/"/);
  assert.match(pkg.scripts.build, /vite build/);
  assert.equal(pkg.name, "quoteengine-studio");
});

test("the studio owns everything it imports", async () => {
  const offenders = [];
  for (const [path, code] of await studioSources()) {
    // A dedicated repository cannot reach back into QuoteEngine's tree.
    if (/from "@\/show|from "@\/interfaces|from "\.\.\/\.\.\/(app|engine|components|hooks)\//.test(code)) {
      offenders.push(path);
    }
    if (/ShowConfig/.test(codeOnly(code))) offenders.push(`${path} (ShowConfig)`);
  }

  assert.deepEqual(offenders, []);
});

test("nothing pulls in a framework the studio does not run under", async () => {
  const offenders = [];
  for (const [path, code] of await studioSources()) {
    if (/from "next\//.test(code)) offenders.push(path);
  }

  assert.deepEqual(offenders, []);
});

test("the studio carries its own settings rather than a show's", async () => {
  const config = await source("config.ts");
  const workspace = await source("screens/LocalWorkspace.tsx");

  assert.match(config, /export type StudioConfig/);
  assert.match(config, /maxGifSeconds/);
  assert.match(workspace, /config: StudioConfig/);
});

/* -- The promise it makes -------------------------------------------------- */

test("the studio has no way to send the opened file anywhere", async () => {
  const offenders = [];
  // Uploading needs one of these. Blob URLs and the mounted file do not.
  const upload = /FormData|XMLHttpRequest|WebSocket|sendBeacon|method:\s*["']POST/;
  for (const [path, code] of await studioSources()) {
    if (upload.test(codeOnly(code))) offenders.push(path);
  }

  assert.deepEqual(offenders, []);
});

test("the only outbound request is the engine, and it is pinned", async () => {
  const offenders = [];
  for (const [path, code] of await studioSources()) {
    // The About page credits FFmpeg and links jsDelivr for the reader.
    if (path === "StudioAbout.tsx") continue;
    for (const line of codeOnly(code).split("\n")) {
      if (!/https?:\/\//.test(line)) continue;
      // One allowance, and it must name an exact version.
      if (/cdn\.jsdelivr\.net\/npm\/@ffmpeg\/core@\d+\.\d+\.\d+\//.test(line)) continue;
      offenders.push(`${path}: ${line.trim()}`);
    }
  }

  assert.deepEqual(offenders, []);
});

test("the worker is served from this origin and the core from the CDN", async () => {
  const client = codeOnly(await source("engine/local/ffmpeg-client.ts"));

  // A module worker cannot be constructed cross-origin however permissive the
  // other origin's CORS headers are, so the small part has to stay local.
  assert.match(client, /classWorkerURL: assetUrl\("worker\/worker\.js"\)/);
  assert.match(client, /coreURL: `\$\{coreBase\}\/ffmpeg-core\.js`/);
  assert.match(client, /wasmURL: `\$\{coreBase\}\/ffmpeg-core\.wasm`/);
  // Self-hosting stays a one-line change rather than a fork.
  assert.match(client, /export function setFFmpegCoreBase/);
});

test("worker assets resolve against the document, so subdirectory hosting works", async () => {
  const client = await source("engine/local/ffmpeg-client.ts");

  assert.match(client, /document\.baseURI/);
  assert.doesNotMatch(codeOnly(client), /window\.location/);
});

test("the single-threaded core is used, so no deployment needs COOP/COEP headers", async () => {
  const client = codeOnly(await source("engine/local/ffmpeg-client.ts"));

  assert.doesNotMatch(client, /SharedArrayBuffer|core-mt/);
});

test("only the worker is installed and copied, never the 32 MB core", async () => {
  const copy = codeOnly(await source("scripts/copy-ffmpeg-worker.mjs"));
  const pkg = JSON.parse(await source("package.json"));
  const ignore = await source(".gitignore");

  assert.match(copy, /"worker\.js", "const\.js", "errors\.js"/);
  assert.doesNotMatch(copy, /ffmpeg-core/);
  // Installing must not drag in 64 MB of WebAssembly nobody serves.
  assert.equal(pkg.dependencies["@ffmpeg/core"], undefined);
  assert.equal(pkg.devDependencies["@ffmpeg/core"], undefined);
  assert.match(ignore, /^\/public\/ffmpeg\/$/m);
});

/* -- Deployment ------------------------------------------------------------ */

test("Pages deploys a built artefact rather than a committed one", async () => {
  const workflow = await source(".github/workflows/pages.yml");

  assert.match(workflow, /actions\/upload-pages-artifact/);
  assert.match(workflow, /actions\/deploy-pages/);
  assert.match(workflow, /path: dist/);
  // A broken build or a failing test must not reach the published site.
  assert.ok(workflow.indexOf("npm test") < workflow.indexOf("upload-pages-artifact"), workflow);
  assert.match(workflow, /pages: write/);
});

/* -- Behaviour that has already regressed once ----------------------------- */

test("the probe pins its log level instead of inheriting the last command's", async () => {
  const local = await source("engine/local/source.ts");

  // FFmpeg's log level is global state inside the wasm instance and survives
  // between runs. Without this, any earlier `-loglevel error` command silences
  // the stream listing and every file looks as though it has no tracks at all.
  assert.match(local, /"-hide_banner", "-loglevel", "info", "-i", path/);
});

test("every FFmpeg invocation states the log level it wants", async () => {
  const local = await source("engine/local/source.ts");
  const invocations = local.match(/ffmpeg\.exec\(\[[\s\S]*?\]/g) ?? [];

  assert.ok(invocations.length >= 4, `expected several invocations, found ${invocations.length}`);
  for (const invocation of invocations) {
    assert.match(invocation, /"-loglevel"/, invocation);
  }
});

test("frame decoding is deferred without depending on a compositing page", async () => {
  const frame = await source("screens/LocalFrame.tsx");

  // IntersectionObserver only reports while the page paints, so an on-screen
  // frame is measured directly instead of waiting for a callback that a
  // background tab or an embedded view would never deliver.
  assert.match(frame, /getBoundingClientRect\(\)/);
  assert.match(frame, /IntersectionObserver/);
});

test("both decoders clamp requests to the size the file actually holds", async () => {
  const frames = await source("engine/local/frames.ts");
  const local = await source("engine/local/source.ts");

  assert.match(frames, /Math\.min\(width, element\.videoWidth \|\| width\)/);
  assert.equal(local.match(/Math\.min\(width, probe\.width\)/g)?.length, 2);
});

test("exactly one component is responsible for releasing the opened file", async () => {
  const workspace = await source("screens/LocalWorkspace.tsx");
  const opener = await source("screens/LocalOpener.tsx");

  assert.match(workspace, /useEffect\(\(\) => \(\) => source\?\.release\(\), \[source\]\)/);
  // The opener is controlled and owns nothing, so it must never release: doing
  // so would tear down a source the workspace is still using.
  assert.doesNotMatch(opener, /\.release\(\)/);
});

test("views are state, because a picked file cannot survive a navigation", async () => {
  const workspace = await source("screens/LocalWorkspace.tsx");
  const app = await source("StudioApp.tsx");

  assert.match(workspace, /useState<LocalView>/);
  assert.doesNotMatch(workspace, /useRouter|router\.push|<Link/);
  assert.doesNotMatch(app, /useRouter|router\.push|<Link/);
});

/* -- Subtitles ------------------------------------------------------------- */

test("the container index is read before the engine is ever considered", async () => {
  const hook = await source("useSubtitles.ts");

  // Free when the file was decoded by FFmpeg anyway; a few kilobytes of header
  // otherwise. Neither costs the 32 MB download.
  assert.match(hook, /source\.initialSubtitleTracks[\s\S]*?sniffSubtitleTracks\(fileReader\(source\.file\), source\.file\.size\)/);
});

test("a subtitle file is only asked for when the video has none", async () => {
  const picker = await source("screens/SubtitlePicker.tsx");

  // Three distinct states: tracks unknown, tracks known and empty, tracks found.
  assert.match(picker, /tracks === null/);
  assert.match(picker, /textTracks\.length === 0/);
  assert.match(picker, /No subtitles are stored in this file/);
  // Falling back to FFmpeg is offered only when the container could not be read.
  assert.match(picker, /\{tracks === null && \(\s*<button/);
});

test("the studio opens without subtitles at all", async () => {
  const opener = await source("screens/LocalOpener.tsx");
  const workspace = await source("screens/LocalWorkspace.tsx");

  // Entering is gated on the video alone, never on the cues.
  assert.match(opener, /disabled=\{!ready\}/);
  assert.match(opener, /const ready = source !== null && !opening;/);
  assert.match(opener, /Open the studio without subtitles/);
  // Nothing to search without them, so that tab is not offered.
  assert.match(workspace, /\{captions\.length > 0 && \(\s*<button className=\{view === "search"/);
  assert.match(workspace, /setView\(captions\.length \? "search" : "scene"\)/);
});

test("captions can be typed by hand when there are no subtitle lines to borrow", async () => {
  const image = await source("screens/LocalImageEditor.tsx");
  const scene = await source("screens/LocalScene.tsx");

  assert.match(image, /\{episode\.captions\.length > 0 && <button/);
  assert.match(image, /\+ Add a caption/);
  assert.match(scene, /transcript-empty/);
  assert.match(scene, /onAddSubtitles/);
});

test("subtitles can be added after the studio is already open", async () => {
  const workspace = await source("screens/LocalWorkspace.tsx");

  // Set-up is returned to rather than rebuilt, so the source and playhead survive.
  assert.match(workspace, /onClick=\{\(\) => setEntered\(false\)\}/);
  assert.match(workspace, /onAddSubtitles=\{\(\) => setEntered\(false\)\}/);
  assert.match(workspace, /const captions = useMemo\(/);
});

/* -- What the About page has to say ---------------------------------------- */

test("the about section is honest that the engine comes from a third party", async () => {
  const about = await source("StudioAbout.tsx");

  // The privacy claim has to match what the code actually does.
  assert.match(about, /jsdelivr/i);
  assert.match(about, /IP address/);
  assert.match(about, /never sees your video/);
  assert.doesNotMatch(about, /no third-party request/);
});

test("the about section discloses the licence of the engine it loads", async () => {
  const about = await source("StudioAbout.tsx");

  assert.match(about, /GPL-2\.0-or-later/);
  assert.match(about, /ffmpeg\.org/);
});

test("the about section is honest about what the studio cannot do", async () => {
  const about = await source("StudioAbout.tsx");

  assert.match(about, /PGS, VobSub and DVB/);
  assert.match(about, /What it cannot do/);
  assert.match(about, /never uploaded|not uploaded/i);
});
