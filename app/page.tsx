"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, Upload, Trash2, Music2, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { normalizeLyricsPackage, type TrackRecord } from "@/lib/schema";
import { parseTextToPackage } from "@/lib/packgen";
import { buildSearchIndex } from "@/lib/search";
import { buildBigramStats } from "@/lib/stats";
import { ZodError } from "zod";
import dynamic from "next/dynamic";

const listFade = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
};

const WordCloud = dynamic(() => import("@/components/WordCloud"), { ssr: false });

type SelectOption = {
  value: string;
  label: string;
  count?: number;
};

const highlightLine = (line: string, query: string) => {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return line;
  const lowerLine = line.toLowerCase();
  const lowerQuery = trimmedQuery.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  while (cursor < line.length) {
    const hitIndex = lowerLine.indexOf(lowerQuery, cursor);
    if (hitIndex === -1) {
      parts.push(line.slice(cursor));
      break;
    }
    if (hitIndex > cursor) {
      parts.push(line.slice(cursor, hitIndex));
    }
    parts.push(<mark key={`${hitIndex}-${cursor}`}>{line.slice(hitIndex, hitIndex + trimmedQuery.length)}</mark>);
    cursor = hitIndex + trimmedQuery.length;
  }
  return parts;
};

const getLyricSnippets = (lyrics: string, query: string, limit = 3) => {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const lines = lyrics.split("\n");
  const hits = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.toLowerCase().includes(trimmed.toLowerCase()));
  const snippets: Array<{ start: number; end: number; lines: string[] }> = [];
  const used = new Set<string>();
  for (const hit of hits) {
    if (snippets.length >= limit) break;
    const start = Math.max(0, hit.index - 1);
    const end = Math.min(lines.length - 1, hit.index + 1);
    const key = `${start}-${end}`;
    if (used.has(key)) continue;
    used.add(key);
    snippets.push({ start, end, lines: lines.slice(start, end + 1) });
  }
  return snippets;
};

const extractFocusedSnippets = (tracks: TrackRecord[], term: string, limit = 8) => {
  const trimmed = term.trim().toLowerCase();
  if (!trimmed) return [];
  const seen = new Set<string>();
  const results: Array<{ line: string; title: string }> = [];
  const perTrackCount = new Map<string, number>();
  for (const track of tracks) {
    const lines = track.lyrics.split("\n");
    for (const line of lines) {
      if (results.length >= limit) return results;
      const normalized = line.trim();
      if (!normalized) continue;
      if (!normalized.toLowerCase().includes(trimmed)) continue;
      if (seen.has(normalized)) continue;
      const used = perTrackCount.get(track.id) ?? 0;
      if (used >= 2) continue;
      seen.add(normalized);
      results.push({ line: normalized, title: track.title });
      perTrackCount.set(track.id, used + 1);
    }
  }
  return results;
};

const DropdownSelect = ({
  label,
  value,
  options,
  open,
  onToggle,
  onSelect,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  open: boolean;
  onToggle: () => void;
  onSelect: (value: string) => void;
}) => {
  const current = options.find((item) => item.value === value) ?? options[0];
  return (
    <div className="relative min-w-[160px]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 rounded-full border border-[var(--panel-border)] bg-[var(--panel-bg)] px-4 py-2 text-sm text-[var(--foreground)]"
      >
        <span className="truncate">{current?.label ?? value}</span>
        <span className="text-[10px] text-[var(--muted)]">⌄</span>
      </button>
      {open ? (
        <div className="absolute left-0 top-[calc(100%+6px)] z-40 w-full overflow-hidden rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-bg-strong)] shadow-[var(--panel-shadow-strong)] backdrop-blur">
          <div className="max-h-64 overflow-y-auto py-2">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onSelect(option.value)}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition ${
                  option.value === value
                    ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "text-[var(--foreground)] hover:bg-[var(--accent)]/5"
                }`}
              >
                <span className="truncate">{option.label}</span>
                {option.count !== undefined ? (
                  <span className="text-[10px] text-[var(--muted)]">{option.count}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default function Home() {
  const [tracks, setTracks] = useState<TrackRecord[]>([]);
  const [query, setQuery] = useState("");
  const [albumFilter, setAlbumFilter] = useState("全部专辑");
  const [lyricistFilter, setLyricistFilter] = useState("全部词作者");
  const [yearFilter, setYearFilter] = useState("全部年份");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [docxPreview, setDocxPreview] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [activeWord, setActiveWord] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [useBottomDrawer, setUseBottomDrawer] = useState(false);
  const [showSingles, setShowSingles] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [openFilter, setOpenFilter] = useState<"album" | "lyricist" | "year" | null>(null);
  const [theme, setTheme] = useState<"warm" | "ink" | "silver" | "bone">("warm");
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    db.tracks.toArray().then((stored) => {
      setTracks(stored);
    });
  }, []);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!filterRef.current) return;
      if (!filterRef.current.contains(event.target as Node)) {
        setOpenFilter(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const update = () => {
      setUseBottomDrawer(mq.matches && window.innerWidth < 900);
    };
    update();
    mq.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const searchIndex = useMemo(() => buildSearchIndex(tracks), [tracks]);

  const albums = useMemo<SelectOption[]>(() => {
    const counts = new Map<string, number>();
    tracks.forEach((track) => {
      counts.set(track.album, (counts.get(track.album) ?? 0) + 1);
    });
    const items = Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const maxNameLen = Math.max(0, ...items.map(([name]) => name.length));
    const maxCountLen = Math.max(1, ...items.map(([, count]) => String(count).length));
    return [
      { value: "全部专辑", label: "全部专辑" },
      ...items.map(([name, count]) => {
        return {
          value: name,
          label: name,
          count,
        };
      }),
    ];
  }, [tracks]);

  const lyricists = useMemo<SelectOption[]>(() => {
    const counts = new Map<string, number>();
    tracks.forEach((track) => {
      track.lyricists.forEach((name) => {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      });
    });
    const items = Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const maxNameLen = Math.max(0, ...items.map(([name]) => name.length));
    const maxCountLen = Math.max(1, ...items.map(([, count]) => String(count).length));
    return [
      { value: "全部词作者", label: "全部词作者" },
      ...items.map(([name, count]) => {
        return {
          value: name,
          label: name,
          count,
        };
      }),
    ];
  }, [tracks]);

  const years = useMemo<SelectOption[]>(() => {
    const counts = new Map<string, number>();
    tracks.forEach((track) => {
      counts.set(track.yearText, (counts.get(track.yearText) ?? 0) + 1);
    });
    const items = Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const maxNameLen = Math.max(0, ...items.map(([name]) => name.length));
    const maxCountLen = Math.max(1, ...items.map(([, count]) => String(count).length));
    return [
      { value: "全部年份", label: "全部年份" },
      ...items.map(([name, count]) => {
        return {
          value: name,
          label: name,
          count,
        };
      }),
    ];
  }, [tracks]);

  const filteredTracks = useMemo(() => {
    let result = searchIndex.search(query);
    if (albumFilter !== "全部专辑") {
      result = result.filter((track) => track.album === albumFilter);
    }
    if (lyricistFilter !== "全部词作者") {
      result = result.filter((track) => track.lyricists.includes(lyricistFilter));
    }
    if (yearFilter !== "全部年份") {
      result = result.filter((track) => track.yearText === yearFilter);
    }
    return result.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"));
  }, [albumFilter, lyricistFilter, yearFilter, query, searchIndex]);

  const filteredTracksForStats = useMemo(() => {
    let result = tracks;
    if (albumFilter !== "全部专辑") {
      result = result.filter((track) => track.album === albumFilter);
    }
    if (lyricistFilter !== "全部词作者") {
      result = result.filter((track) => track.lyricists.includes(lyricistFilter));
    }
    if (yearFilter !== "全部年份") {
      result = result.filter((track) => track.yearText === yearFilter);
    }
    return result;
  }, [albumFilter, lyricistFilter, yearFilter, tracks]);

  const tokens = useMemo(() => {
    const computed = buildBigramStats(filteredTracksForStats, 120, { includeSingle: showSingles });
    if (computed.length > 0) return computed;
    if (tracks.length > 0) {
      return buildBigramStats(tracks, 120, { includeSingle: showSingles });
    }
    return computed;
  }, [filteredTracksForStats, tracks, showSingles]);

  const displayTokens = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return tokens;
    if (/[A-Za-z]/.test(trimmed)) return tokens;
    const exists = tokens.some((item) => item.token === trimmed);
    if (exists) return tokens;
    const maxCount = tokens.reduce((max, item) => Math.max(max, item.count), 1);
    return [{ token: trimmed, count: Math.max(2, Math.round(maxCount * 0.8)) }, ...tokens];
  }, [tokens, query]);

  const topTokens = useMemo(() => tokens.slice(0, 15), [tokens]);
  const maxTokenCount = useMemo(
    () => topTokens.reduce((max, token) => Math.max(max, token.count), 1),
    [topTokens]
  );
  const importedFiles = useMemo(() => {
    const counts = new Map<string, number>();
    tracks.forEach((track) => {
      if (!track.sourceFile) return;
      counts.set(track.sourceFile, (counts.get(track.sourceFile) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tracks]);


  const handleImport = async (file?: File | null) => {
    if (!file) return;
    setLoading(true);
    setStatus(null);
    try {
      const extension = file.name.split(".").pop()?.toLowerCase();
      let normalized;
      if (extension === "json") {
        const text = await file.text();
        const parsed = JSON.parse(text);
        normalized = normalizeLyricsPackage(parsed);
      } else if (extension === "txt") {
        const text = await file.text();
        const parsed = parseTextToPackage(text);
        parsed.tracks = parsed.tracks.filter(
          (track) => track.lyrics && track.lyrics.trim().length > 0
        );
        const seen = new Set<string>();
        parsed.tracks = parsed.tracks.filter((track) => {
          const key = `${parsed.artist}__${track.title}__${track.year ?? ""}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (parsed.tracks.length === 0) {
          setStatus("未识别到歌词正文（可能段落/换行被吞）");
          return;
        }
        normalized = normalizeLyricsPackage(parsed);
      } else if (extension === "docx") {
        const arrayBuffer = await file.arrayBuffer();
        const mammoth = await import("mammoth");
        const htmlResult = await mammoth.convertToHtml({ arrayBuffer });
        let docxText = htmlResult.value || "";
        if (docxText) {
          docxText = docxText
            .replace(/<\s*br\s*\/?>/gi, "\n")
            .replace(/<\/\s*p\s*>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/gi, " ");
        } else {
          const result = await mammoth.extractRawText({ arrayBuffer });
          docxText = result.value || "";
        }
        if (/<\/?(p|br)\b/i.test(docxText)) {
          docxText = docxText
            .replace(/<\s*br\s*\/?>/gi, "\n")
            .replace(/<\/\s*p\s*>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/gi, " ");
        }
        docxText = docxText
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n")
          .replace(/[\u000b\f\u2028\u2029]/g, "\n");
        if (process.env.NODE_ENV !== "production") {
          console.log("DOCX_TEXT_START");
          console.log(docxText);
          console.log("DOCX_TEXT_END");
        }
        setDocxPreview(docxText);
        const parsed = parseTextToPackage(docxText);
        parsed.tracks = parsed.tracks.filter(
          (track) => track.lyrics && track.lyrics.trim().length > 0
        );
        const seen = new Set<string>();
        parsed.tracks = parsed.tracks.filter((track) => {
          const key = `${parsed.artist}__${track.title}__${track.year ?? ""}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (parsed.tracks.length === 0) {
          setStatus("未识别到歌词正文（可能段落/换行被吞）");
          return;
        }
        normalized = normalizeLyricsPackage(parsed);
        normalized.tracks = normalized.tracks.map((track) => ({
          ...track,
          sourceFile: file.name,
        }));
        if (process.env.NODE_ENV !== "production") {
          console.log(normalized.tracks.map((track) => track.title));
        }
      } else {
        throw new Error("不支持的文件格式，请选择 JSON/TXT/DOCX");
      }
      if (!normalized) {
        return;
      }
      await db.transaction("rw", db.tracks, async () => {
        await db.tracks.bulkPut(normalized.tracks);
      });
      const updated = await db.tracks.toArray();
      setTracks(updated);
      setStatus(`解析并导入 ${normalized.tracks.length} 首歌曲`);
    } catch (error) {
      console.error(error);
      if (error instanceof ZodError) {
        setStatus("导入失败：存在缺失歌词的曲目。请检查文件内容（详情见 console）。");
      } else {
        setStatus(error instanceof Error ? error.message : "导入失败，请检查文件内容");
      }
    } finally {
      setLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleImportFiles = async (files?: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoading(true);
    setStatus(null);
    let totalImported = 0;
    for (const file of Array.from(files)) {
      try {
        const extension = file.name.split(".").pop()?.toLowerCase();
        let normalized;
        if (extension === "json") {
          const text = await file.text();
          const parsed = JSON.parse(text);
          normalized = normalizeLyricsPackage(parsed);
        } else if (extension === "txt") {
          const text = await file.text();
          const parsed = parseTextToPackage(text);
          parsed.tracks = parsed.tracks.filter(
            (track) => track.lyrics && track.lyrics.trim().length > 0
          );
          const seen = new Set<string>();
          parsed.tracks = parsed.tracks.filter((track) => {
            const key = `${parsed.artist}__${track.title}__${track.year ?? ""}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          if (parsed.tracks.length === 0) {
            continue;
          }
          normalized = normalizeLyricsPackage(parsed);
        } else if (extension === "docx") {
          const arrayBuffer = await file.arrayBuffer();
          const mammoth = await import("mammoth");
          const htmlResult = await mammoth.convertToHtml({ arrayBuffer });
          let docxText = htmlResult.value || "";
          if (docxText) {
            docxText = docxText
              .replace(/<\s*br\s*\/?>/gi, "\n")
              .replace(/<\/p>/gi, "\n")
              .replace(/<[^>]+>/g, "")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&amp;/g, "&")
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'");
          }
          const parsed = parseTextToPackage(docxText);
          parsed.tracks = parsed.tracks.filter(
            (track) => track.lyrics && track.lyrics.trim().length > 0
          );
          const seen = new Set<string>();
          parsed.tracks = parsed.tracks.filter((track) => {
            const key = `${parsed.artist}__${track.title}__${track.year ?? ""}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          if (parsed.tracks.length === 0) {
            continue;
          }
          normalized = normalizeLyricsPackage(parsed);
          normalized.tracks = normalized.tracks.map((track) => ({
            ...track,
            sourceFile: file.name,
          }));
        } else {
          continue;
        }
        if (!normalized) continue;
        await db.transaction("rw", db.tracks, async () => {
          await db.tracks.bulkPut(normalized.tracks);
        });
        totalImported += normalized.tracks.length;
      } catch (error) {
        console.error(error);
      }
    }
    const updated = await db.tracks.toArray();
    setTracks(updated);
    setStatus(totalImported ? `解析并导入 ${totalImported} 首歌曲` : "未导入任何歌曲");
    setLoading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleClear = async () => {
    await db.tracks.clear();
    setTracks([]);
    setExpandedId(null);
    setStatus("已清空本地数据");
  };

  const handleRemoveFile = async (fileName: string) => {
    const toDelete: string[] = [];
    await db.tracks.filter((track) => track.sourceFile === fileName).each((track) => {
      toDelete.push(track.id);
    });
    if (toDelete.length) {
      await db.tracks.bulkDelete(toDelete);
    }
    const updated = await db.tracks.toArray();
    setTracks(updated);
    setStatus(`已删除 ${fileName}`);
  };

  return (
    <div
      className={`relative h-screen overflow-hidden bg-[var(--surface)] app-shell ${
        theme === "ink"
          ? "theme-ink"
          : theme === "silver"
          ? "theme-silver"
          : theme === "bone"
          ? "theme-bone"
          : "theme-warm"
      }`}
    >
      <div className="absolute inset-0">
        <div className="absolute inset-0 z-0">
          {displayTokens.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
            导入歌词后生成词频云。
          </div>
        ) : (
          <WordCloud
            words={displayTokens.map((item) => ({ text: item.token, value: item.count }))}
            maxWords={120}
            showAll={showAll}
            selectedWord={activeWord ?? undefined}
            snippets={activeWord ? extractFocusedSnippets(filteredTracksForStats, activeWord, 15) : []}
            onSelect={(token) => {
              setActiveWord((prev) => (prev === token ? null : token));
              setQuery((prev) => (prev === token ? "" : token));
            }}
            onClear={() => {
              setActiveWord(null);
              setQuery("");
            }}
          />
        )}
        </div>
        <div className="absolute left-6 top-6 z-40 flex items-center gap-3 text-[var(--accent)] pointer-events-auto">
          <Music2 className="h-4 w-4" />
          <span className="text-xs uppercase tracking-[0.3em]">Lyrics Pulse</span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setThemeMenuOpen((prev) => !prev)}
              className="rounded-full border border-[var(--accent)]/30 px-2 py-0.5 text-[10px] text-[var(--accent)]/80"
            >
              色系
            </button>
            <AnimatePresence>
              {themeMenuOpen ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.96, x: -6 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.96, x: -6 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="absolute left-full top-1/2 z-50 ml-2 inline-flex -translate-y-1/2 items-center gap-1 overflow-hidden rounded-full border border-[var(--panel-border)] bg-[var(--panel-bg-strong)] shadow-[var(--panel-shadow-strong)] backdrop-blur"
              >
                {(
                  [
                    { value: "warm", label: "暖" },
                    { value: "ink", label: "墨绿" },
                    { value: "silver", label: "银青" },
                    { value: "bone", label: "骨蓝" },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => {
                      setTheme(item.value);
                      setThemeMenuOpen(false);
                    }}
                    className={`whitespace-nowrap px-3 py-2 text-[10px] ${
                      theme === item.value
                        ? "bg-[var(--accent)]/10 text-[var(--accent)] rounded-full"
                        : "text-[var(--foreground)] hover:bg-[var(--accent)]/5 rounded-full"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </motion.div>
            ) : null}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <aside
        className={`fixed z-40 ${useBottomDrawer ? "bottom-4 right-3" : "right-0 top-3"}`}
      >
        <div className={`${useBottomDrawer ? "flex flex-row" : "flex flex-col"} gap-2`}>
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            className={`border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 py-2 text-[10px] font-semibold tracking-[0.35em] text-[var(--accent)]/80 shadow-[var(--panel-shadow)] backdrop-blur ${
              useBottomDrawer ? "rounded-full" : "rounded-l-full"
            }`}
          >
            导入
          </button>
          <button
            type="button"
            onClick={() => setListOpen(true)}
            className={`border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 py-2 text-[10px] font-semibold tracking-[0.35em] text-[var(--accent)]/80 shadow-[var(--panel-shadow)] backdrop-blur ${
              useBottomDrawer ? "rounded-full" : "rounded-l-full"
            }`}
          >
            列表
          </button>
        </div>
      </aside>

      <AnimatePresence>
        {panelOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`fixed inset-0 z-50 bg-black/20 backdrop-blur-sm ${
              useBottomDrawer ? "flex items-end justify-center" : "flex items-stretch justify-end"
            }`}
            onClick={() => setPanelOpen(false)}
          >
            <motion.div
              initial={useBottomDrawer ? { y: 260 } : { x: 260 }}
              animate={useBottomDrawer ? { y: 0 } : { x: 0 }}
              exit={useBottomDrawer ? { y: 260 } : { x: 260 }}
              transition={{ type: "spring", stiffness: 180, damping: 22 }}
              className={`overflow-hidden bg-transparent shadow-[var(--panel-shadow-strong)] panel-text-contrast ${
                useBottomDrawer
                  ? "h-[75vh] w-full max-w-[680px] rounded-t-3xl"
                  : "h-full w-full max-w-[360px] rounded-l-3xl"
              }`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-[var(--accent)]/10 px-6 py-4">
                <div className="flex items-center gap-2 text-[var(--accent)]">
                  <Sparkles className="h-4 w-4" />
                  <span className="text-sm uppercase tracking-[0.3em]">Import</span>
                </div>
                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
                  className="rounded-full border border-[var(--accent)]/30 px-3 py-1 text-xs text-[var(--accent)]"
                >
                  收起
                </button>
              </div>
              <div
              className={`overflow-y-auto px-6 py-5 text-xs text-[var(--muted)] ${
                useBottomDrawer ? "h-[calc(75vh-72px)]" : "h-[calc(100vh-72px)]"
              }`}
            >
                <div className="mt-4 flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".json,.txt,.docx,application/json,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(event) => handleImportFiles(event.target.files)}
            />
                  <button
                    className="flex items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-lg"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading}
                  >
                    <Upload className="h-4 w-4" />
                    导入歌词
                  </button>
                  <button
                    className="flex items-center justify-center gap-2 rounded-full border border-[var(--panel-border)] px-3 py-2 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/10"
                    onClick={handleClear}
                    disabled={!tracks.length}
                  >
                    <Trash2 className="h-4 w-4" />
                    清空本地
                  </button>
                  <div className="text-[10px] text-[var(--muted)]">
                    当前已存：{tracks.length} 首
                  </div>
                </div>
                {status && <p className="mt-3 text-xs text-[var(--accent)]">{status}</p>}
                <div className="mt-4 flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-[0.3em] text-[var(--accent)]/80">
                    高频词
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAll((prev) => !prev)}
                    className="rounded-full border border-[var(--accent)]/30 px-2 py-0.5 text-[10px] text-[var(--accent)]/80"
                  >
                    {showAll ? "收起" : "更多"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSingles((prev) => !prev)}
                    className="rounded-full border border-[var(--accent)]/30 px-2 py-0.5 text-[10px] text-[var(--accent)]/80"
                  >
                    单字：{showSingles ? "开" : "关"}
                  </button>
                </div>
                <div className="mt-5 rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-bg-soft)] p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-[0.35em] text-[var(--accent)]">词频</span>
                    <span className="text-[10px] text-[var(--muted)]">Top 15</span>
                  </div>
                  {topTokens.length === 0 ? (
                    <p className="mt-3 text-xs text-[var(--muted)]">暂无词频数据</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {topTokens.map((token) => (
                        <div key={token.token} className="flex items-center gap-3">
                          <span className="w-12 shrink-0 text-xs text-[var(--foreground)]">
                            {token.token}
                          </span>
                          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface)]/70">
                            <div
                              className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]/70"
                              style={{ width: `${(token.count / maxTokenCount) * 100}%` }}
                            />
                          </div>
                          <span className="w-8 text-right text-[10px] text-[var(--muted)]">
                            {token.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {importedFiles.length > 0 ? (
                  <div className="mt-5 rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-bg-soft)] p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-[0.35em] text-[var(--accent)]">
                        已导入文件
                      </span>
                      <span className="text-[10px] text-[var(--muted)]">DOCX</span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {importedFiles.map((item) => (
                        <div key={item.name} className="flex items-center gap-2">
                          <div className="flex-1 truncate text-[11px] text-[var(--foreground)]">
                            {item.name}
                          </div>
                          <span className="text-[10px] text-[var(--muted)]">{item.count}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveFile(item.name)}
                            className="rounded-full border border-[var(--accent)]/30 px-2 py-0.5 text-[10px] text-[var(--accent)]"
                          >
                            移除
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {process.env.NODE_ENV !== "production" && docxPreview ? (
                  <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--panel-bg-strong)] p-3 text-[10px] text-[var(--muted)]">
                    {(docxPreview || "").slice(0, 1200)}
                  </pre>
                ) : null}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {listOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`fixed inset-0 z-50 bg-black/25 backdrop-blur-sm ${
              useBottomDrawer ? "flex items-end justify-center" : "flex items-stretch justify-end"
            }`}
            onClick={() => setListOpen(false)}
          >
            <motion.div
              initial={useBottomDrawer ? { y: 260 } : { x: 260 }}
              animate={useBottomDrawer ? { y: 0 } : { x: 0 }}
              exit={useBottomDrawer ? { y: 260 } : { x: 260 }}
              transition={{ type: "spring", stiffness: 180, damping: 22 }}
            className={`overflow-hidden bg-transparent shadow-[var(--panel-shadow-strong)] panel-text-contrast ${
              useBottomDrawer
                ? "h-[80vh] w-full max-w-[760px] rounded-t-3xl"
                : "h-full w-full max-w-[520px] rounded-l-3xl"
            }`}
              onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-[var(--accent)]/10 px-6 py-4">
                  <div className="flex items-center gap-2 text-[var(--accent)]">
                    <Search className="h-4 w-4" />
                    <span className="text-sm uppercase tracking-[0.3em]">Lyrics List</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setListOpen(false)}
                    className="rounded-full border border-[var(--accent)]/30 px-3 py-1 text-xs text-[var(--accent)]"
                  >
                    收起
                  </button>
                </div>
                <div
                  className={`overflow-y-auto px-6 py-5 ${
                    useBottomDrawer ? "h-[calc(80vh-72px)]" : "h-[calc(100vh-72px)]"
                  }`}
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 rounded-full border border-[var(--panel-border)] bg-[var(--panel-bg)] px-4 py-2">
                      <Search className="h-4 w-4 text-[var(--accent)]" />
                      <input
                        value={query}
                        onChange={(event) => {
                          setQuery(event.target.value);
                          setActiveWord(event.target.value.trim() ? event.target.value : null);
                        }}
                        placeholder="输入关键词，搜索标题、歌词、专辑、词作者..."
                        className="w-full bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
                      />
                    </div>
                    <div ref={filterRef} className="flex flex-wrap gap-3">
                      <DropdownSelect
                        label="专辑"
                        value={albumFilter}
                        options={albums}
                        open={openFilter === "album"}
                        onToggle={() => setOpenFilter((prev) => (prev === "album" ? null : "album"))}
                        onSelect={(value) => {
                          setAlbumFilter(value);
                          setOpenFilter(null);
                        }}
                      />
                      <DropdownSelect
                        label="词作者"
                        value={lyricistFilter}
                        options={lyricists}
                        open={openFilter === "lyricist"}
                        onToggle={() => setOpenFilter((prev) => (prev === "lyricist" ? null : "lyricist"))}
                        onSelect={(value) => {
                          setLyricistFilter(value);
                          setOpenFilter(null);
                        }}
                      />
                      <DropdownSelect
                        label="年份"
                        value={yearFilter}
                        options={years}
                        open={openFilter === "year"}
                        onToggle={() => setOpenFilter((prev) => (prev === "year" ? null : "year"))}
                        onSelect={(value) => {
                          setYearFilter(value);
                          setOpenFilter(null);
                        }}
                      />
                    </div>
                  </div>
                  <motion.div
                    className="mt-6 grid gap-4"
                    variants={listFade}
                    initial="initial"
                    animate="animate"
                  >
                    {filteredTracks.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-[var(--panel-border)] bg-[var(--panel-bg-soft)] p-6 text-sm text-[var(--muted)]">
                        暂无匹配歌曲。导入 JSON 或调整关键词/过滤条件。
                      </div>
                    ) : (
                      filteredTracks.map((track) => {
                        const isExpanded = expandedId === track.id;
                        const snippets = getLyricSnippets(track.lyrics, query);
                        return (
                          <motion.div
                            key={track.id}
                            layout
                            className="rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-bg-soft)] p-5 shadow-sm"
                          >
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : track.id)}
                              className="flex w-full flex-col gap-3 text-left"
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <h3 className="text-lg font-semibold text-[var(--foreground)]">
                                    {track.title}
                                  </h3>
                                  <p className="text-xs text-[var(--muted)]">
                                    {track.album} · {track.yearText} · {track.lyricists.join(" / ")}
                                  </p>
                                </div>
                                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)]">
                                  {isExpanded ? "−" : "+"}
                                </span>
                              </div>
                            </button>
                            {query.trim() && snippets.length > 0 ? (
                              <div className="mt-4 rounded-xl bg-[var(--surface)]/70 px-4 py-3 text-sm text-[var(--foreground)]">
                                {snippets.map((snippet, snippetIndex) => (
                                  <div
                                    key={`${track.id}-snippet-${snippetIndex}`}
                                    className={
                                      snippetIndex > 0 ? "mt-3 border-t border-[var(--accent)]/10 pt-3" : ""
                                    }
                                  >
                                    {snippet.lines.map((line, lineIndex) => (
                                      <div
                                        key={`${track.id}-line-${snippetIndex}-${lineIndex}`}
                                        className="whitespace-pre-wrap break-words"
                                      >
                                        {line ? highlightLine(line, query) : "\u00a0"}
                                      </div>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            <AnimatePresence>
                              {isExpanded && (
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: "auto" }}
                                  exit={{ opacity: 0, height: 0 }}
                                  className="mt-4 overflow-hidden whitespace-pre-wrap break-words rounded-xl bg-[var(--surface)]/80 p-4 text-sm leading-7 text-[var(--foreground)]"
                                >
                                  {query.trim()
                                    ? track.lyrics.split("\n").map((line, index) => (
                                        <div
                                          key={`${track.id}-full-${index}`}
                                          className="whitespace-pre-wrap break-words"
                                        >
                                          {line ? highlightLine(line, query) : "\u00a0"}
                                        </div>
                                      ))
                                    : track.lyrics}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </motion.div>
                        );
                      })
                    )}
                  </motion.div>
                </div>
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>
    </div>
  );
}
