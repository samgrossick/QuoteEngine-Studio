import type { StudioConfig } from "./config";

type Credit = { role: string; name: string; note: string; url?: string };

const CREDITS: Credit[] = [
  {
    role: "Decoding",
    name: "FFmpeg",
    note: "GPL-2.0-or-later, compiled to WebAssembly",
    url: "https://ffmpeg.org/",
  },
  {
    role: "Wrapper",
    name: "ffmpeg.wasm",
    note: "MIT",
    url: "https://ffmpegwasm.netlify.app/",
  },
  {
    role: "Search, editors, GIF encoder",
    name: "QuoteEngine",
    note: "The archive engine this studio is built from",
    url: "https://github.com/davidgibson-uk/QuoteEngine",
  },
];

export function StudioAbout({ config }: { config: StudioConfig }) {
  return (
    <main className="page-shell">
      <section className="page-heading compact-heading">
        <p className="eyebrow">{config.name}</p>
        <h1>What this is.</h1>
        <p>
          A subtitle-driven meme and GIF maker for a video file you already have. Open the file,
          search what was said, jump to the moment, and export a captioned still, GIF or short
          video. There is no library to build and no account to make.
        </p>
      </section>

      <div className="about-layout">
        <div className="about-body">
          <h2>Nothing leaves this tab</h2>
          <p>
            The file you pick is read by the browser directly. It is not uploaded, not copied to a
            server, and not written anywhere on disk. Frames are decoded in the page and finished
            stills, GIFs and videos download straight to your device.
          </p>
          <p>
            There are no accounts, cookies, analytics, or saved settings, and nothing is remembered
            between visits — reopening the studio means picking the file again. That is a deliberate
            trade: the price of never holding your media is never recognising it either.
          </p>
          <p>
            One request does leave, and it is worth being precise about. Files the browser cannot
            decode by itself need FFmpeg, and that 32&nbsp;MB decoder is fetched from a public CDN
            rather than served from here. The CDN sees your IP address, the way it would for any
            image or font on any site. It never sees your video, its name, or anything derived from
            it — those are read only by this tab.
          </p>

          <h2>How it opens a file</h2>
          <p>
            The browser is tried first. When it can decode the file itself, seeking is close to
            instant and no extra machinery loads at all. Anything the browser refuses is handed to
            FFmpeg compiled to WebAssembly, which reads the file in place rather than loading it
            into memory, so a multi-gigabyte recording opens without exhausting the tab.
          </p>
          <p>
            Subtitles are a separate question from pictures. A subtitle file sitting next to the
            video needs no extra machinery. A subtitle track stored <em>inside</em> the video always
            does, because no browser lets a page read embedded subtitle streams — so a file the
            browser can play may still load the FFmpeg engine purely to fetch the words.
          </p>
          <p>
            You should not have to know which of those you have. So when a file is opened, the
            studio reads the container&apos;s own index first — a few kilobytes from the front of
            the file, whatever its size — to find out whether there are subtitles in there at all.
            If there are, the obvious one is loaded for you. If there are not, you are told so, and
            the engine is never downloaded to discover nothing.
          </p>

          <h2>Subtitles are optional</h2>
          <p>
            They make the file searchable, which is the fastest way to find a moment and the reason
            most of this exists. But you can skip them entirely: open the video, scrub to what you
            want, and type your own caption. You can add subtitles later without losing your place.
          </p>

          <table className="about-table">
            <caption>What happens with what you open</caption>
            <thead>
              <tr><th scope="col">You have</th><th scope="col">What the studio does</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>MP4 or WebM with no subtitles inside it</td>
                <td>Browser decoding. The engine never loads, and you are asked for a subtitle file only if you want one.</td>
              </tr>
              <tr>
                <td>A video with subtitles embedded in it</td>
                <td>The track is found in the container index and loaded for you; the engine downloads once, to read it.</td>
              </tr>
              <tr>
                <td>MKV, AVI, or anything the browser will not play</td>
                <td>The engine decodes a short working copy around whatever you are editing, and already knows the tracks.</td>
              </tr>
              <tr>
                <td>No subtitles anywhere, or none you want</td>
                <td>Scrub to the moment and type the caption yourself.</td>
              </tr>
            </tbody>
          </table>

          <h2>What it cannot do</h2>
          <p>
            <strong>Image-based subtitles.</strong> PGS, VobSub and DVB tracks are pictures of the
            words rather than the words themselves, so they cannot be searched. They are listed and
            refused rather than half-working; open a text subtitle file instead.
          </p>
          <p>
            <strong>Instant scrubbing on the slow path.</strong> When FFmpeg is doing the decoding,
            moving to a new part of the file transcodes a short window first, which takes a few
            seconds. Editing inside that window is then as quick as anywhere else.
          </p>
          <p>
            <strong>More than one file at a time.</strong> The studio holds a single video and its
            subtitles. Searching a whole series end to end is what the full QuoteEngine archive is
            for.
          </p>

          <h2>The engine is a large download</h2>
          <p>
            The FFmpeg build is around 32&nbsp;MB, fetched from{" "}
            <a className="text-link" href="https://www.jsdelivr.com/" target="_blank" rel="noreferrer">jsDelivr</a>{" "}
            and pinned to an exact version so the bytes cannot change underneath the page. It is
            only fetched when a file actually needs it — a video the browser can play, with
            subtitles beside it or none at all, never triggers it. Once loaded it is reused for the
            rest of the visit, and your browser caches it for the next one.
          </p>
          <p>
            Serving it from here instead would avoid the CDN entirely; it is a one-line change for
            anyone running their own copy, at the cost of pushing 32&nbsp;MB per visitor through
            their own hosting.
          </p>

          <h2>Copyright</h2>
          <p>
            Use only media you are legally entitled to process. Owning or subscribing to something
            does not necessarily grant permission to publish processed copies of it, and publishing
            extracted frames or dialogue may require permission from the rights holders. What you
            make here is yours to be careful with.
          </p>
        </div>

        <aside className="about-credits">
          <p className="section-kicker">Built with</p>
          <dl>
            {CREDITS.map((credit) => (
              <div className="about-credit" key={credit.name}>
                <dt>{credit.role}</dt>
                <dd>
                  {credit.url
                    ? <a className="text-link" href={credit.url} target="_blank" rel="noreferrer">{credit.name}</a>
                    : credit.name}
                  <small>{credit.note}</small>
                </dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>

      <p className="about-disclaimer">
        The FFmpeg core this studio loads is licensed GPL-2.0-or-later. It is fetched from a public
        CDN rather than served from here, so hosting the studio does not itself redistribute it —
        but if you choose to serve the core yourself, its licence terms apply to what you serve.
      </p>
    </main>
  );
}
