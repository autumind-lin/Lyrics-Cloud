type PackageTrack = {
  title: string;
  album?: string;
  year?: number | string;
  lyricists?: string[];
  lyrics: string;
};

type PackageResult = {
  schema_version: 1;
  artist: string;
  tracks: PackageTrack[];
};

type ParseOptions = {
  defaultArtist?: string;
};

const decodeEntities = (text: string) =>
  text
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number.parseInt(dec, 10)));

const normalizeText = (text: string) =>
  decodeEntities(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ");

const splitArtists = (value: string) =>
  value
    .split(/[、,，;/|]+/g)
    .map((item) => item.trim())
    .filter(Boolean);

const albumLineRe = /^《\s*(.+?)\s*》\s*(\d{4})?\s*(.+)?$/;
const titleLineRe = /^([<＜〈《【「]\s*)(.+?)(\s*[>＞〉》】」])(?:(.*))$/;
const lyricistRe = /(作词|作詞)[:：]\s*([^作曲]+?)(?=$|\s+作曲|　|&nbsp;)/;
const composerRe = /(作曲)[:：]\s*(.+)$/;
const nakedTitleRe = /^[\u4e00-\u9fa5A-Za-z0-9\s·・]{2,12}$/;

type Draft = {
  title: string;
  lyricists: string[];
  composers: string[];
  lines: string[];
};

const looksLikeNakedTitle = (line: string) => {
  const compact = line.replace(/\s+/g, "");
  if (compact.length < 2 || compact.length > 12) return false;
  if (line.includes(":") || line.includes("：")) return false;
  return nakedTitleRe.test(line);
};

const isDev = () => process.env.NODE_ENV !== "production";

const applyCreditsFromLine = (line: string, draftRef: Draft) => {
  const normalized = line.replace(/\s+/g, " ").trim();
  let applied = false;
  const lyricist = normalized.match(lyricistRe);
  if (lyricist?.[2]) {
    draftRef.lyricists.push(...splitArtists(lyricist[2]));
    applied = true;
  }
  const composer = normalized.match(composerRe);
  if (composer?.[2]) {
    draftRef.composers.push(...splitArtists(composer[2]));
    applied = true;
  }
  return applied;
};

const isCreditOnlyLine = (line: string) =>
  /^(作词|作詞|作曲)\s*[:：]/.test(line.replace(/\s+/g, " ").trim());

export const parseTextToPackage = (text: string, options: ParseOptions = {}): PackageResult => {
  const raw = normalizeText(text);
  const lines = raw.split("\n").map((line) => line.trim());
  const countTitles = lines.reduce((count, line) => (line.match(titleLineRe) ? count + 1 : count), 0);
  if (isDev()) {
    console.log("PACKGEN_DEBUG", {
      preview: raw.slice(0, 400),
      hasNewline: raw.includes("\n"),
      countTitles,
    });
  }

  let artist = options.defaultArtist?.trim() || "未知艺人";
  let album = "未归档";
  let year: string | number | undefined = undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(albumLineRe);
    if (match) {
      album = match[1]?.trim() || album;
      if (match[2]) year = match[2];
      if (match[3]?.trim()) artist = match[3].trim();
    }
    break;
  }

  const tracks: PackageTrack[] = [];
  let draft: Draft | null = null;
  let prevWasEmpty = true;

  const flushDraft = () => {
    if (!draft) return;
    const hasLyrics = draft.lines.some((line) => line.trim().length > 0);
    if (!draft.title || !hasLyrics) {
      draft = null;
      return;
    }
    const lyrics = draft.lines.join("\n").trimEnd();
    tracks.push({
      title: draft.title,
      album,
      year,
      lyricists: draft.lyricists.length ? draft.lyricists : undefined,
      lyrics,
    });
    draft = null;
  };

  const startDraft = (title: string) => {
    draft = {
      title,
      lyricists: [],
      composers: [],
      lines: [],
    };
  };

  for (const line0 of lines) {
    const line = line0.trim();
    if (!line) {
      if (draft) draft.lines.push("");
      prevWasEmpty = true;
      continue;
    }

    const albumMatch = line.match(albumLineRe);
    if (albumMatch) {
      album = albumMatch[1]?.trim() || album;
      if (albumMatch[2]) year = albumMatch[2];
      if (albumMatch[3]?.trim()) artist = albumMatch[3].trim();
      prevWasEmpty = false;
      continue;
    }

    const titleMatch = line.match(titleLineRe);
    if (titleMatch) {
      if (draft) flushDraft();
      startDraft(titleMatch[2].trim());
      const rest = titleMatch[4]?.trim();
      if (rest && draft) {
        applyCreditsFromLine(rest, draft);
      }
      prevWasEmpty = false;
      continue;
    }

    if (prevWasEmpty && looksLikeNakedTitle(line)) {
      if (draft) flushDraft();
      startDraft(line.trim());
      prevWasEmpty = false;
      continue;
    }

    if (!draft) {
      prevWasEmpty = false;
      continue;
    }

    const creditApplied = applyCreditsFromLine(line, draft);
    if (creditApplied && isCreditOnlyLine(line)) {
      prevWasEmpty = false;
      continue;
    }

    draft.lines.push(line);
    prevWasEmpty = false;
  }

  if (draft) flushDraft();
  if (isDev()) {
    console.log(
      "PACKGEN_TRACKS",
      tracks.map((track) => ({
        title: track.title,
        lyricLines: track.lyrics.split("\n").filter((line) => line.trim()).length,
        lyricistsLen: track.lyricists?.length ?? 0,
      }))
    );
  }

  return {
    schema_version: 1,
    artist,
    tracks,
  };
};
