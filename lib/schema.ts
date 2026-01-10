import { z } from "zod";

export const TrackInputSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1, "title is required"),
  album: z.string().optional(),
  year: z.union([z.string(), z.number()]).optional(),
  lyricists: z.union([z.string(), z.array(z.string())]).optional(),
  lyrics: z.string().min(1, "lyrics is required"),
});

export const LyricsPackageSchema = z.object({
  schema_version: z.union([z.string(), z.number()]),
  artist: z.string().min(1, "artist is required"),
  tracks: z.array(TrackInputSchema).min(1, "tracks is required"),
});

export type TrackRecord = {
  id: string;
  title: string;
  album: string;
  year: number | null;
  yearText: string;
  lyricists: string[];
  lyrics: string;
  artist: string;
};

export type NormalizedPackage = {
  schemaVersion: string;
  artist: string;
  tracks: TrackRecord[];
};

const nonWordSplit = /[、,，;/|]+/g;

const normalizeLyricists = (value?: string | string[]): string[] => {
  if (!value) {
    return [];
  }
  const source = Array.isArray(value) ? value.join(" ") : value;
  return source
    .split(nonWordSplit)
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeYear = (value?: string | number): { year: number | null; yearText: string } => {
  if (value === undefined || value === null || value === "") {
    return { year: null, yearText: "未知" };
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) {
    return { year: parsed, yearText: String(parsed) };
  }
  return { year: null, yearText: String(value) };
};

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
};

const makeId = (artist: string, title: string, album: string, yearText: string) => {
  const base = `${artist}-${title}-${album}-${yearText}`.replace(/\s+/g, "-");
  return `${base}-${hashString(base)}`;
};

export const normalizeLyricsPackage = (input: unknown): NormalizedPackage => {
  const parsed = LyricsPackageSchema.parse(input);
  const schemaVersion = String(parsed.schema_version);
  const artist = parsed.artist.trim();

  const tracks = parsed.tracks.map((track) => {
    const title = track.title.trim();
    const album = track.album ? track.album.trim() : "未归档";
    const { year, yearText } = normalizeYear(track.year);
    const lyricists = normalizeLyricists(track.lyricists);
    const lyrics = track.lyrics.trim();
    const id = track.id ?? makeId(artist, title, album, yearText);

    return {
      id,
      title,
      album,
      year,
      yearText,
      lyricists: lyricists.length ? lyricists : ["佚名"],
      lyrics,
      artist,
    };
  });

  return { schemaVersion, artist, tracks };
};
