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
  for (const track of tracks) {
    const lines = track.lyrics.split("\n");
    for (const line of lines) {
      if (results.length >= limit) return results;
      const normalized = line.trim();
      if (!normalized) continue;
      if (!normalized.toLowerCase().includes(trimmed)) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      results.push({ line: normalized, title: track.title });
    }
  }
  return results;
};

export default function Home() {
  const [tracks, setTracks] = useState<TrackRecord[]>([]);
  const [query, setQuery] = useState("");
  const [albumFilter, setAlbumFilter] = useState("全部专辑");
  const [lyricistFilter, setLyricistFilter] = useState("全部词作者");
  const [yearFilter, setYearFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [docxPreview, setDocxPreview] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [activeWord, setActiveWord] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [useBottomDrawer, setUseBottomDrawer] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    db.tracks.toArray().then((stored) => {
      setTracks(stored);
    });
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

  const albums = useMemo(() => {
    const set = new Set(tracks.map((track) => track.album));
    return ["全部专辑", ...Array.from(set).sort()];
  }, [tracks]);

  const lyricists = useMemo(() => {
    const set = new Set(tracks.flatMap((track) => track.lyricists));
    return ["全部词作者", ...Array.from(set).sort()];
  }, [tracks]);

  const filteredTracks = useMemo(() => {
    let result = searchIndex.search(query);
    if (albumFilter !== "全部专辑") {
      result = result.filter((track) => track.album === albumFilter);
    }
    if (lyricistFilter !== "全部词作者") {
      result = result.filter((track) => track.lyricists.includes(lyricistFilter));
    }
    if (yearFilter.trim()) {
      result = result.filter((track) => track.yearText.includes(yearFilter.trim()));
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
    if (yearFilter.trim()) {
      result = result.filter((track) => track.yearText.includes(yearFilter.trim()));
    }
    return result;
  }, [albumFilter, lyricistFilter, yearFilter, tracks]);

  const tokens = useMemo(() => {
    const computed = buildBigramStats(filteredTracksForStats, 120);
    if (computed.length > 0) return computed;
    if (tracks.length > 0) {
      return buildBigramStats(tracks, 120);
    }
    return computed;
  }, [filteredTracksForStats, tracks]);


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

  const handleClear = async () => {
    await db.tracks.clear();
    setTracks([]);
    setExpandedId(null);
    setStatus("已清空本地数据");
  };

  return (
    <div className="relative h-screen overflow-hidden bg-[var(--surface)]">
      <div className="absolute inset-0">
        {tokens.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
            导入歌词后生成词频云。
          </div>
        ) : (
          <WordCloud
            words={tokens.map((item) => ({ text: item.token, value: item.count }))}
            maxWords={120}
            selectedWord={activeWord ?? undefined}
            snippets={activeWord ? extractFocusedSnippets(filteredTracksForStats, activeWord, 6) : []}
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
        <div className="pointer-events-none absolute left-6 top-6 flex items-center gap-2 text-[var(--accent)]">
          <Music2 className="h-4 w-4" />
          <span className="text-xs uppercase tracking-[0.3em]">Lyrics Pulse</span>
        </div>
      </div>

      <aside
        className={`fixed z-40 ${useBottomDrawer ? "bottom-4 right-4" : "right-0 top-1/2 -translate-y-1/2"}`}
      >
        <div className={`${useBottomDrawer ? "flex flex-row" : "flex flex-col"} gap-2`}>
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            className={`border border-white/40 bg-white/65 px-3 py-2 text-[11px] font-semibold tracking-[0.35em] text-[var(--accent)] shadow-[0_12px_26px_-12px_rgba(60,42,30,0.35)] backdrop-blur-md ${
              useBottomDrawer ? "rounded-full" : "rounded-l-full"
            }`}
          >
            导入
          </button>
          <button
            type="button"
            onClick={() => setListOpen(true)}
            className={`border border-white/40 bg-white/65 px-3 py-2 text-[11px] font-semibold tracking-[0.35em] text-[var(--accent)] shadow-[0_12px_26px_-12px_rgba(60,42,30,0.35)] backdrop-blur-md ${
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
              className={`overflow-hidden bg-white/85 shadow-[0_24px_50px_-20px_rgba(60,42,30,0.45)] ${
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
                <div className="flex items-center gap-2 rounded-full border border-[var(--accent)]/20 bg-white/70 px-3 py-2">
                  <Search className="h-3 w-3 text-[var(--accent)]" />
                  <input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setActiveWord(event.target.value.trim() ? event.target.value : null);
                    }}
                    placeholder="搜索关键词..."
                    className="w-full bg-transparent text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
                  />
                </div>
                <div className="mt-4 flex flex-col gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,.txt,.docx,application/json,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={(event) => handleImport(event.target.files?.[0])}
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
                    className="flex items-center justify-center gap-2 rounded-full border border-[var(--accent)]/40 px-3 py-2 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/10"
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
                {process.env.NODE_ENV !== "production" && docxPreview ? (
                  <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white/80 p-3 text-[10px] text-[var(--muted)]">
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
              className={`overflow-hidden bg-white/90 shadow-[0_24px_50px_-20px_rgba(60,42,30,0.45)] ${
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
                  <div className="flex flex-wrap gap-3">
                    <div className="flex flex-1 items-center gap-2 rounded-full border border-[var(--accent)]/20 bg-white px-4 py-2">
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
                    <select
                      value={albumFilter}
                      onChange={(event) => setAlbumFilter(event.target.value)}
                      className="rounded-full border border-[var(--accent)]/20 bg-white px-4 py-2 text-sm text-[var(--foreground)]"
                    >
                      {albums.map((album) => (
                        <option key={album} value={album}>
                          {album}
                        </option>
                      ))}
                    </select>
                    <select
                      value={lyricistFilter}
                      onChange={(event) => setLyricistFilter(event.target.value)}
                      className="rounded-full border border-[var(--accent)]/20 bg-white px-4 py-2 text-sm text-[var(--foreground)]"
                    >
                      {lyricists.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <input
                      value={yearFilter}
                      onChange={(event) => setYearFilter(event.target.value)}
                      placeholder="年份过滤"
                      className="rounded-full border border-[var(--accent)]/20 bg-white px-4 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]"
                    />
                  </div>
                  <motion.div
                    className="mt-6 grid gap-4"
                    variants={listFade}
                    initial="initial"
                    animate="animate"
                  >
                    {filteredTracks.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-[var(--accent)]/30 bg-white/60 p-6 text-sm text-[var(--muted)]">
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
                            className="rounded-2xl border border-[var(--accent)]/20 bg-white/80 p-5 shadow-sm"
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
