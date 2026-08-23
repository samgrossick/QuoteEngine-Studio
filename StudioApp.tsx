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
            <span className="studio-mark" aria-hidden="true">QE</span>
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

      <footer className="studio-footer">
        <span>Everything happens in this tab. Nothing is uploaded, and nothing is remembered.</span>
        <button type="button" className="text-link" onClick={() => setSection("about")}>Licences and limits</button>
      </footer>
    </>
  );
}
