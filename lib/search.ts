import type { TrackRecord } from "./schema";

export type SearchIndex = {
  index: unknown;
  byId: Map<string, TrackRecord>;
  search: (query: string) => TrackRecord[];
};

export const buildSearchIndex = (tracks: TrackRecord[]): SearchIndex => {
  const byId = new Map(tracks.map((track) => [track.id, track]));
  let fastSearch: ((query: string) => TrackRecord[]) | null = null;

  const fallbackSearch = (query: string) => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return tracks;
    }
    return tracks.filter((track) => {
      const haystack = [
        track.title,
        track.album,
        track.yearText,
        track.lyricists.join(" "),
        track.lyrics,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(trimmed);
    });
  };

  if (typeof window !== "undefined") {
    void (async () => {
      try {
        const mod = await import("flexsearch");
        const DocumentCtor =
          (mod as any).Document ?? (mod as any).default?.Document;
        if (!DocumentCtor) {
          return;
        }
        const index = new DocumentCtor({
          document: {
            id: "id",
            index: ["lyrics", "title", "album", "lyricists", "yearText"],
          },
          tokenize: "full",
          encode: "icase",
          cache: 100,
        });
        tracks.forEach((track) => {
          index.add(track.id, {
            ...track,
            lyricists: track.lyricists.join(" "),
          });
        });
        fastSearch = (query: string) => {
          const trimmed = query.trim();
          if (!trimmed) {
            return tracks;
          }
          const results = index.search(trimmed, { enrich: true });
          const ids = new Set<string>();
          results.forEach((fieldResult: { result: Array<{ id: string }> }) => {
            fieldResult.result.forEach((match) => {
              ids.add(String(match.id));
            });
          });
          return Array.from(ids)
            .map((id) => byId.get(id))
            .filter((track): track is TrackRecord => Boolean(track));
        };
      } catch {
        fastSearch = null;
      }
    })();
  }

  const search = (query: string) => {
    if (fastSearch) {
      try {
        return fastSearch(query);
      } catch {
        return fallbackSearch(query);
      }
    }
    return fallbackSearch(query);
  };

  return { index: null, byId, search };
};
