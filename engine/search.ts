import type { SearchEpisode, SearchHit } from "./types";

function resultTime(hit: SearchHit) {
  return hit.caption.frameTime ?? hit.caption.frameSecond;
}

export function normalizeSearchText(value: string, locale = "en-GB") {
  return value
    .toLocaleLowerCase(locale)
    .replace(/<[^>]+>/g, " ")
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function alternativesFor(term: string, aliases: Record<string, string[]>) {
  for (const [canonical, alternatives] of Object.entries(aliases)) {
    const group = [canonical, ...alternatives].map((value) => normalizeSearchText(value));
    if (group.includes(term)) return group;
  }
  return [term];
}

type CatalogIndex = {
  positions: Array<[episode: number, caption: number]>;
  tokens: Map<string, Set<number>>;
};

const catalogIndexes = new WeakMap<SearchEpisode[], CatalogIndex>();

function indexCatalog(episodes: SearchEpisode[]) {
  const cached = catalogIndexes.get(episodes);
  if (cached) return cached;
  const positions: CatalogIndex["positions"] = [];
  const tokens = new Map<string, Set<number>>();
  episodes.forEach((episode, episodeIndex) => episode.captions.forEach((caption, captionIndex) => {
    const position = positions.push([episodeIndex, captionIndex]) - 1;
    const windowText = caption.searchWindowText ?? caption.searchText;
    for (const token of new Set(windowText.split(" ").filter(Boolean))) {
      const matches = tokens.get(token) ?? new Set<number>();
      matches.add(position);
      tokens.set(token, matches);
    }
  }));
  const index = { positions, tokens };
  catalogIndexes.set(episodes, index);
  return index;
}

export function searchCatalog(
  episodes: SearchEpisode[],
  query: string,
  aliases: Record<string, string[]> = {},
  locale = "en-GB",
  limit = 36,
) {
  const cleaned = normalizeSearchText(query, locale);
  if (!cleaned) return [];

  const terms = cleaned.split(" ");
  const termGroups = terms.map((term) => alternativesFor(term, aliases));
  const hits: SearchHit[] = [];
  const index = indexCatalog(episodes);
  const candidates = new Set<number>();
  for (const group of termGroups) {
    for (const alternative of group) {
      for (const [token, positions] of index.tokens) {
        if (!token.includes(alternative)) continue;
        positions.forEach((position) => candidates.add(position));
      }
    }
  }

  for (const position of candidates) {
      const [episodeIndex, captionIndex] = index.positions[position];
      const episode = episodes[episodeIndex];
      const caption = episode.captions[captionIndex];
      const windowText = caption.searchWindowText ?? episode.captions
        .slice(Math.max(0, captionIndex - 1), captionIndex + 2)
        .map((item) => item.searchText)
        .join(" ");
      const currentPhrase = caption.searchText.includes(cleaned);
      const windowPhrase = windowText.includes(cleaned);
      const currentTerms = termGroups.filter((group) =>
        group.some((term) => caption.searchText.includes(term)),
      ).length;
      const windowTerms = termGroups.filter((group) =>
        group.some((term) => windowText.includes(term)),
      ).length;
      if (!currentPhrase && !windowPhrase && windowTerms === 0) continue;

      const allCurrentTerms = currentTerms === termGroups.length;
      const allWindowTerms = windowTerms === termGroups.length;
      hits.push({
        episode,
        caption,
        score: (currentPhrase ? 5000 : 0)
          + (allCurrentTerms ? 3000 : 0)
          + (!currentPhrase && windowPhrase ? 2400 : 0)
          + (!allCurrentTerms && allWindowTerms ? 1800 : 0)
          + currentTerms * 100
          + windowTerms * 10,
      });
  }

  const ranked = hits
    .sort((a, b) =>
      b.score - a.score
      || a.episode.season - b.episode.season
      || a.episode.episode - b.episode.episode
      || a.caption.startMs - b.caption.startMs,
    );
  const deduplicated: SearchHit[] = [];
  for (const hit of ranked) {
    const overlapsSelectedScene = deduplicated.some((selected) =>
      selected.episode.id === hit.episode.id
      && Math.abs(resultTime(selected) - resultTime(hit)) < 10,
    );
    if (overlapsSelectedScene) continue;
    deduplicated.push(hit);
    if (deduplicated.length >= limit) break;
  }
  return deduplicated;
}
