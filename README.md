# QuoteEngine Studio

Make captioned stills, GIFs and short clips from a video **on your own device**.
Open a file, search what was said, jump to the moment, and export. There is no
upload, no account, and no library to build.

The file you pick is read by the browser directly. It is not uploaded, not copied
anywhere, and not written to disk. Frames are decoded in the page and finished
files download straight to your device.

> [!NOTE]
> This is a standalone application built from [QuoteEngine](https://github.com/davidgibson-uk/QuoteEngine),
> which is a self-hosted archive for a whole programme. The studio reuses its
> search ranking, editors and GIF encoder, pointed at a single local file
> instead of an ingested catalogue.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Then open [http://localhost:3100](http://localhost:3100).

## Build it

```bash
npm run build
```

That writes `dist/` — a plain static site, about 330 KB. Serve it from anything:
GitHub Pages, a static host, or `npm run preview`.

## How it opens a file

The browser is tried first. If `<video>` can decode the file, seeking it is far
faster than anything else available and no extra machinery loads at all. Anything
the browser refuses is handed to FFmpeg compiled to WebAssembly, which mounts the
file lazily rather than reading it into memory, so a multi-gigabyte MKV opens
without exhausting the tab.

Subtitles are found rather than asked for. Opening a file reads the container's own
index — `moov` in MP4, `Tracks` in Matroska, a few kilobytes from the front whatever
the file's size — so the studio knows whether there are subtitles inside before it
decides to fetch anything. If there are, the obvious track is loaded for you. If
there are not, you are told so and offered a subtitle file.

Subtitles are optional. They make the file searchable, which is the quickest way to
find a moment, but you can open a video without any and type captions by hand — and
add subtitles later without losing your place.

| Situation | What happens |
| --- | --- |
| MP4 or WebM with nothing embedded | Browser decoding; the engine is never fetched |
| Any file with subtitles embedded in the container | Track found in the index and loaded for you; the engine is fetched once to read it |
| MKV, AVI or anything the browser cannot play | Engine decodes a short working copy, and already knows the tracks |
| No subtitles at all | Scrub to the moment and type the caption yourself |

### What it cannot do

- **Image-based subtitles.** PGS, VobSub and DVB tracks are listed and refused rather
  than half-working, because they are pictures of the words rather than the words.
- **Instant scrubbing on the engine path.** When FFmpeg is doing the decoding, moving
  to a new part of the file transcodes a short window first. Editing within that
  window is then as quick as anywhere else.
- **More than one file at a time.** To search a whole programme end to end, use the
  full QuoteEngine archive.

## The FFmpeg engine

The engine is split in two, for a reason worth knowing if you fork this.

The **core** is about 32 MB of WebAssembly and is fetched at run time from
[jsDelivr](https://www.jsdelivr.com/), pinned to an exact version. That keeps this
site small and its hosting bandwidth near zero. It is the only request the studio
makes to anyone else: the CDN sees your IP address the way it would for any asset,
and never sees your video or anything derived from it.

The **worker** is three files totalling about six kilobytes, copied out of
`node_modules` at build time into `public/ffmpeg/worker`. It cannot come from the
CDN with the core: a module worker can only be constructed from a same-origin URL,
however permissive the other origin's CORS headers are.

To serve the core yourself instead, install `@ffmpeg/core`, copy its
`dist/esm` output into `public/ffmpeg`, and call `setFFmpegCoreBase` in
[`main.tsx`](main.tsx):

```ts
setFFmpegCoreBase(new URL("ffmpeg", document.baseURI).href);
```

The single-threaded core is used deliberately: the multi-threaded one needs
`SharedArrayBuffer`, which would force every deployment to serve COOP and COEP
headers.

> [!IMPORTANT]
> The FFmpeg core is licensed **GPL-2.0-or-later**. Fetched from a CDN, hosting this
> studio does not itself redistribute it. If you self-host the core, its licence
> terms apply to what you serve.

## Deploying to GitHub Pages

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) lints, tests, builds and
publishes `dist/` on every push to `main`. Turn it on once, in
**Settings → Pages → Build and deployment → Source → GitHub Actions**.

Assets are built with a relative base, so a project site served from
`https://you.github.io/quoteengine-studio/` works with no configuration.

## Tests

```bash
npm test
```

The suite covers the subtitle parsers (SRT, WebVTT, ASS), the MP4 and Matroska
container index readers, and the guarantees that are easy to regress — that the
opened file has no route off the device, that the engine is only fetched when
there is something to decode, and that the About page's claims still match what
the code does.

## Licence

No open-source licence has been selected yet. Until one is added, copyright in the
application source remains with its contributors and normal copyright restrictions
apply. Media you open remains the property of its respective rights holders — use
only material you are legally entitled to process.
