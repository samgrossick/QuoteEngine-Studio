import { useState } from "react";
import { studioConfig } from "./config";
import { StudioAbout } from "./StudioAbout";
import { LocalWorkspace } from "./screens/LocalWorkspace";

type Section = "studio" | "about";

/**
 * The whole application.
 *
 * There is no router, no server and no catalogue: the studio is a static page
 * that reads a file the visitor picks and does everything else in the tab.
 */
export function StudioApp() {
  const [section, setSection] = useState<Section>("studio");

  return (
    <>
      <header className="studio-masthead">
        <div className="studio-masthead-inner">
          {/* A button, not a link: there is nowhere to navigate to. */}
          <button className="studio-brand" type="button" onClick={() => setSection("studio")}>
            {/* The same geometry as the favicon, so the tab and the page agree. */}
            <span className="studio-mark" aria-hidden="true">
              <svg viewBox="0 0 64 64" focusable="false">
                <rect className="studio-mark-plate" width="64" height="64" rx="13" />
                <g className="studio-mark-glyph" transform="translate(-2.5 0)">
                  <circle cx="21" cy="40" r="7.5" />
                  <path d="M17.6 34.8 27.2 15.4 33.4 18.5 23.8 37.9Z" />
                  <circle cx="43" cy="40" r="7.5" />
                  <path d="M39.6 34.8 49.2 15.4 55.4 18.5 45.8 37.9Z" />
                </g>
              </svg>
            </span>
            <span className="studio-brand-copy">
              <strong>{studioConfig.name}</strong>
              <small>{studioConfig.tagline}</small>
            </span>
          </button>
          <nav className="studio-nav" aria-label="Sections">
            <button
              type="button"
              className={section === "studio" ? "active" : ""}
              aria-current={section === "studio" ? "page" : undefined}
              onClick={() => setSection("studio")}
            >Studio</button>
            <button
              type="button"
              className={section === "about" ? "active" : ""}
              aria-current={section === "about" ? "page" : undefined}
              onClick={() => setSection("about")}
            >About</button>
          </nav>
        </div>
      </header>

      {section === "studio" ? <LocalWorkspace config={studioConfig} /> : <StudioAbout config={studioConfig} />}

      {/* The rule spans the viewport while the content stays measured, which is
          how the masthead is built. Without the wrapper the border stopped at
          the content width and read as a broken, half-length line. */}
      <footer className="studio-footer">
        <div className="studio-footer-inner">
          <span>Everything happens in this tab. Nothing is uploaded, and nothing is remembered.</span>
          <button type="button" className="text-link" onClick={() => setSection("about")}>Licences and limits</button>
        </div>
      </footer>
    </>
  );
}
