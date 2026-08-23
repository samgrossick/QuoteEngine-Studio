import { useMemo, useState } from "react";
import { Highlighted } from "@/components/Highlighted";
import { LocalFrame } from "./LocalFrame";
import { captionTime, formatTime } from "@/engine/media";
import { searchCatalog } from "@/engine/search";
import type { LocalSource } from "@/engine/local/source";
import type { StudioConfig } from "../config";
import type { SearchEpisode } from "@/engine/types";
import type { LocalView } from "./LocalWorkspace";

/**
 * Dialogue search over the opened file.
 *
 * The catalogue's own ranking does the work, so phrases split across two
 * subtitle lines still match and results in the same scene collapse into one.
 */
export function LocalSearch({ source, episode, config, onOpen }: {
  source: LocalSource;
  episode: SearchEpisode;
  config: StudioConfig;
  onOpen: (view: LocalView, time: number) => void;
}) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();

  const results = useMemo(
    () => trimmed ? searchCatalog([episode], trimmed, config.searchAliases, config.locale, 60) : [],
    [episode, config.locale, config.searchAliases, trimmed],
  );

  return (
    <section className="local-search">
      <div className="section-title-row results-toolbar">
        <div>
          <p className="section-kicker">Dialogue search</p>
          <h2>{trimmed ? results.length ? `Matches for “${trimmed}”` : "No dialogue found" : "Search this file"}</h2>
        </div>
        <div className="filter-row">
          <span className="result-count">{episode.captionCount.toLocaleString()} lines indexed</span>
        </div>
      </div>

      <form className="search results-page-search" role="search" onSubmit={(event) => event.preventDefault()}>
        <label className="sr-only" htmlFor="local-search">Search the dialogue in this file</label>
        <input
          id="local-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={config.searchPlaceholder}
          autoComplete="off"
        />
        <button className="search-submit" type="button" onClick={() => setQuery("")} disabled={!query}>Clear</button>
      </form>

      {!trimmed ? (
        <div className="empty-state">
          <strong>What are you looking for?</strong>
          <p>Type a line, or a memorable fragment of one. Nothing is sent anywhere — the search runs over the subtitles already in this tab.</p>
          <button className="secondary-action" type="button" onClick={() => onOpen("scene", 0)}>Browse from the start instead</button>
        </div>
      ) : results.length === 0 ? (
        <div className="empty-state">
          <strong>No exact moment found.</strong>
          <p>Try fewer words, a different spelling, or a memorable fragment of the line.</p>
        </div>
      ) : (
        <div className="results-grid">
          {results.map((hit) => {
            const time = captionTime(hit.caption);
            return (
              <article className="search-result" key={hit.caption.id}>
                <button className="frame-button" type="button" onClick={() => onOpen("scene", time)}>
                  <LocalFrame source={source} time={time} width={360} alt={`Frame at ${formatTime(time)}`} />
                  <span className="time-chip">{hit.caption.timestamp.slice(3)}</span>
                </button>
                <div className="result-copy">
                  <p><Highlighted text={hit.caption.text} query={trimmed} /></p>
                  <span className="result-episode">{episode.title}</span>
                  <div className="card-footer card-footer-wrap">
                    <button type="button" onClick={() => onOpen("scene", time)}>Scene</button>
                    <button type="button" onClick={() => onOpen("image", time)}>Image</button>
                    <button type="button" onClick={() => onOpen("gif", time)}>GIF</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
