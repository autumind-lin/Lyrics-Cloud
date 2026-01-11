"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type WordItem = {
  text: string;
  value: number;
};

type LayoutWord = {
  text: string;
  value: number;
  x: number;
  y: number;
  size: number;
  rotate: number;
  width?: number;
  height?: number;
};

type WordCloudProps = {
  words: WordItem[];
  maxWords?: number;
  showAll?: boolean;
  selectedWord?: string;
  snippets?: Array<{ line: string; title?: string }>;
  onSelect?: (word: string) => void;
  onClear?: () => void;
};

const baseWords = 45;
const expandedWords = 100;
const sizeThreshold = 2;

const normalizeWords = (input: WordItem[] | undefined | null) => {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item) => item && typeof item.text === "string")
    .map((item) => ({
      text: item.text.trim(),
      value: Number(item.value),
    }))
    .filter(
      (item) =>
        item.text.length > 0 &&
        Number.isFinite(item.value) &&
        item.value >= 1 &&
        !/^[\s\p{P}\p{S}]+$/u.test(item.text)
    );
};

const highlightSnippet = (line: string, keyword: string) => {
  const trimmed = keyword.trim();
  if (!trimmed) return line;
  const lowerLine = line.toLowerCase();
  const lowerKey = trimmed.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  while (cursor < line.length) {
    const hit = lowerLine.indexOf(lowerKey, cursor);
    if (hit === -1) {
      parts.push(line.slice(cursor));
      break;
    }
    if (hit > cursor) {
      parts.push(line.slice(cursor, hit));
    }
    parts.push(
      <span key={`${hit}-${cursor}`} className="snippet-mark">
        {line.slice(hit, hit + trimmed.length)}
      </span>
    );
    cursor = hit + trimmed.length;
  }
  return parts;
};

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const seededRandom = (seed: number) => {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return value / 2147483647;
  };
};

const placeSnippets = (
  snippets: Array<{ line: string; title?: string }>,
  seed: number,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  fontSize: number,
  allowWrap: boolean,
  verticalSpread: boolean
) => {
  const rand = seededRandom(seed);
  const placed: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    size: number;
    line: string;
    title?: string;
    wrap: boolean;
  }> = [];
  const minDist = verticalSpread ? 110 : 120;
  const minCenterDist = verticalSpread ? 150 : 170;
  const padding = 36;
  const gap = allowWrap ? 10 : 14;
  const maxWidth = Math.min(width - padding * 2, allowWrap ? width * 0.86 : 420);
  const aspect = Math.max(0.6, Math.min(1.9, width / Math.max(1, height)));
  const spreadX = 1 + Math.max(0, aspect - 1) * 0.9;
  const spreadY = Math.min(1.05, 1 / Math.max(0.9, spreadX));
  const centerBox = { w: 180, h: 120 };
  for (let i = 0; i < snippets.length; i += 1) {
    const text = snippets[i].line;
    const title = snippets[i].title ? ` — ${snippets[i].title}` : "";
    const rawLength = Math.max(1, text.length + title.length);
    const fitSize = Math.max(14, Math.min(fontSize, Math.floor(maxWidth / (rawLength * 0.62))));
    const lineHeight = fitSize * 1.45;
    const boxHeight = allowWrap ? lineHeight * 1.7 : lineHeight;
    const estimatedWidth = Math.min(
      maxWidth,
      Math.max(160, Math.min(maxWidth, rawLength * fitSize * 0.62))
    );
    const needsWrap = allowWrap && estimatedWidth > maxWidth * 0.92;
    let angle = rand() * Math.PI * 2;
    let radius = 130 + rand() * 80 + i * 14;
    let x = centerX + radius * Math.cos(angle) * spreadX;
    let y = centerY + radius * Math.sin(angle) * spreadY;
    if (verticalSpread) {
      const direction = i % 2 === 0 ? -1 : 1;
      const offsetIndex = Math.ceil((i + 1) / 2);
      x = centerX + (rand() - 0.5) * (allowWrap ? 40 : 80);
      y = centerY + direction * (offsetIndex * (lineHeight + 10));
    }
    x = Math.max(padding + estimatedWidth / 2, Math.min(width - padding - estimatedWidth / 2, x));
    y = Math.max(padding + boxHeight / 2, Math.min(height - padding - boxHeight / 2, y));
    let attempts = 0;
    let placedOk = false;
    while (attempts < 120) {
    const tooClose =
      Math.hypot(x - centerX, y - centerY) < minCenterDist ||
        (Math.abs(x - centerX) < centerBox.w / 2 + estimatedWidth / 2 + gap &&
          Math.abs(y - centerY) < centerBox.h / 2 + boxHeight / 2 + gap) ||
        placed.some((p) => {
          const overlapX = Math.abs(p.x - x) < p.w / 2 + estimatedWidth / 2 + gap;
          const overlapY = Math.abs(p.y - y) < p.h / 2 + boxHeight / 2 + gap;
          return overlapX && overlapY;
        }) ||
        placed.some((p) => Math.hypot(p.x - x, p.y - y) < minDist * (spreadY >= 1 ? 1.35 : 1.1));
      if (!tooClose) {
        placedOk = true;
        break;
      }
      radius += 18;
      angle += 2.3999632297;
      x = centerX + radius * Math.cos(angle) * spreadX;
      y = centerY + radius * Math.sin(angle) * spreadY;
      if (verticalSpread) {
        const direction = (attempts % 2 === 0 ? -1 : 1) * (i % 2 === 0 ? -1 : 1);
        x = centerX + (rand() - 0.5) * (allowWrap ? 50 : 90);
        y = centerY + direction * ((Math.ceil((i + 1) / 2) + attempts) * (lineHeight + 8));
      }
      x = Math.max(padding + estimatedWidth / 2, Math.min(width - padding - estimatedWidth / 2, x));
      y = Math.max(padding + boxHeight / 2, Math.min(height - padding - boxHeight / 2, y));
      attempts += 1;
    }
    if (!placedOk) continue;
    placed.push({
      x,
      y,
      w: estimatedWidth,
      h: boxHeight,
      size: fitSize,
      line: text,
      title: snippets[i].title,
      wrap: needsWrap,
    });
  }
  return placed;
};

export default function WordCloud({
  words,
  maxWords = expandedWords,
  showAll = false,
  selectedWord,
  snippets = [],
  onSelect,
  onClear,
}: WordCloudProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // particle layer removed
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [layoutWords, setLayoutWords] = useState<LayoutWord[]>([]);
  const clickGuardRef = useRef(0);
  const lastSizeRef = useRef({ width: 0, height: 0 });
  const lastRenderKeyRef = useRef<string>("");
  const fontRangeRef = useRef({ min: 12, max: 36 });
  const resizeTimerRef = useRef<number | null>(null);

  const normalizedWords = useMemo(() => normalizeWords(words), [words]);
  const limit = showAll ? maxWords : baseWords;
  const trimmedWords = useMemo(() => normalizedWords.slice(0, limit), [normalizedWords, limit]);
  const wordsKey = useMemo(
    () => trimmedWords.map((item) => `${item.text}:${item.value}`).join("|"),
    [trimmedWords]
  );
  const isCompact = size.width > 0 && size.width < 720;
  const snippetFontSize = 22;
  const allowWrap = false;
  const verticalSpread = false;
  const selectedNode = useMemo(
    () => layoutWords.find((word) => word.text === selectedWord),
    [layoutWords, selectedWord]
  );
  const focusOffset = useMemo(() => {
    if (!selectedWord || !selectedNode) return { x: 0, y: 0 };
    return {
      x: size.width / 2 - selectedNode.x,
      y: size.height / 2 - selectedNode.y,
    };
  }, [selectedWord, selectedNode, size.width, size.height]);
  const snippetNodes = useMemo(() => {
    if (!selectedWord || snippets.length === 0 || !size.width || !size.height) return [];
    const centerX = (selectedNode?.x ?? anchor?.x ?? size.width / 2) + focusOffset.x;
    const centerY = (selectedNode?.y ?? anchor?.y ?? size.height / 2) + focusOffset.y;
    const maxSnippets = Math.min(15, snippets.length);
    const seed = hashString(
      `${selectedWord}-${snippets.length}-${size.width}x${size.height}-${Math.round(centerX)}-${Math.round(centerY)}`
    );
    return placeSnippets(
      snippets.slice(0, maxSnippets),
      seed,
      size.width,
      size.height,
      centerX,
      centerY,
      snippetFontSize,
      allowWrap,
      verticalSpread
    );
  }, [
    selectedWord,
    snippets,
    size.width,
    size.height,
    anchor,
    snippetFontSize,
    allowWrap,
    verticalSpread,
    selectedNode,
    focusOffset,
  ]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const next = { width: rect.width, height: rect.height };
      const prev = lastSizeRef.current;
      if (
        Math.abs(prev.width - next.width) <= sizeThreshold &&
        Math.abs(prev.height - next.height) <= sizeThreshold
      ) {
        return;
      }
      lastSizeRef.current = next;
      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = window.setTimeout(() => {
        setSize(next);
        const base = Math.min(next.width, next.height);
        const scale = next.width < 720 ? 0.78 : 1;
        fontRangeRef.current = {
          min: Math.max(11, Math.round(base * 0.024 * scale)),
          max: Math.max(18, Math.round(base * 0.13 * scale)),
        };
      }, 120);
    });
    observer.observe(containerRef.current);
    return () => {
      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current);
      }
      observer.disconnect();
    };
  }, []);

  // sand/grain layer removed

  useEffect(() => {
    if (!size.width || !size.height) return;
    if (trimmedWords.length === 0) {
      setLayoutWords([]);
      return;
    }
    let cancelled = false;
    setError(null);
    const renderKey = `${wordsKey}|${size.width}x${size.height}`;
    if (renderKey === lastRenderKeyRef.current) return;
    lastRenderKeyRef.current = renderKey;
    const seed = hashString(renderKey);
    const rng = seededRandom(seed);

    const run = async () => {
      try {
        const mod = await import("d3-cloud");
        if (cancelled) return;
        const cloud = (mod as any).default ?? mod;
        const list = trimmedWords.map((item) => ({ text: item.text, value: item.value }));
        const maxValue = Math.max(...list.map((item) => item.value), 1);
        const minValue = Math.min(...list.map((item) => item.value), maxValue);
        const range = Math.max(1, maxValue - minValue);
        const { min, max } = fontRangeRef.current;
        const fontScale = (value: number) => {
          const normalized =
            Math.log1p(Math.max(0, value - minValue)) / Math.log1p(range + 1);
          return min + (max - min) * Math.sqrt(Math.max(0, normalized));
        };

        const layout = cloud()
          .size([size.width, size.height])
          .words(list.map((w) => ({ ...w, size: fontScale(w.value) })))
          .padding(6)
          .rotate(() => 0)
          .font('"Noto Serif SC","Source Han Serif SC","STSong","Songti SC","SimSun",serif')
          .fontSize((d: any) => d.size)
          .random(() => rng());

        layout.on("end", (words: LayoutWord[]) => {
          if (cancelled) return;
          if (!words.length) {
            setLayoutWords([]);
            return;
          }
          let minX = Infinity;
          let maxX = -Infinity;
          let minY = Infinity;
          let maxY = -Infinity;
          words.forEach((w: any) => {
            const wHalf = (w.width ?? w.size * w.text.length * 0.6) / 2;
            const hHalf = (w.height ?? w.size) / 2;
            minX = Math.min(minX, w.x - wHalf);
            maxX = Math.max(maxX, w.x + wHalf);
            minY = Math.min(minY, w.y - hHalf);
            maxY = Math.max(maxY, w.y + hHalf);
          });
          const rawW = Math.max(1, maxX - minX);
          const rawH = Math.max(1, maxY - minY);
          const scale = Math.min((size.width * 0.86) / rawW, (size.height * 0.86) / rawH, 1.15);
          const centered = words.map((w: any) => ({
            text: w.text,
            value: w.value,
            x: size.width / 2 + w.x * scale,
            y: size.height / 2 + w.y * scale,
            size: w.size * scale,
            rotate: w.rotate ?? 0,
            width: (w.width ?? w.size * w.text.length * 0.6) * scale,
            height: (w.height ?? w.size) * scale,
          }));
          setLayoutWords(centered);
        });

        layout.start();
      } catch (err) {
        setError(err instanceof Error ? err.message : "wordcloud_error");
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [size.width, size.height, trimmedWords, wordsKey]);

  const isReady = size.width > 0 && size.height > 0;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden font-poetic wordcloud-root"
      onClick={() => {
        if (Date.now() - clickGuardRef.current < 200) {
          return;
        }
        setAnchor(null);
        onClear?.();
      }}
    >
      <div className="absolute inset-0 z-0 wordcloud-gradient pointer-events-none" />
      <div className="absolute inset-0 z-[1] wordcloud-noise pointer-events-none" />
      {/* sand/grain layer removed */}
      {!isReady ? (
        <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
          词云加载中...
        </div>
      ) : trimmedWords.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
          暂无可展示词云（请先导入歌词或调整筛选）。
        </div>
      ) : error ? (
        <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
          词云渲染失败：{error}
        </div>
      ) : (
        <>
          <div
            className={`absolute inset-0 z-10 transition-opacity duration-700 ${
              selectedWord ? "opacity-75" : "opacity-90"
            }`}
          >
            {layoutWords.map((word) => {
              const isSelected = selectedWord === word.text;
              const isDimmed = Boolean(selectedWord && !isSelected);
              const selX = selectedNode?.x ?? word.x;
              const selY = selectedNode?.y ?? word.y;
              const dx = word.x - selX;
              const dy = word.y - selY;
              const dist = Math.max(1, Math.hypot(dx, dy));
              const push = selectedWord
                ? Math.min(120, Math.max(50, Math.min(size.width, size.height) / 6))
                : 0;
              const tx = isDimmed ? (dx / dist) * push : 0;
              const ty = isDimmed ? (dy / dist) * push : 0;
              const alpha = isDimmed ? 0.16 : 0.92;
              const focusTx = isSelected ? focusOffset.x : 0;
              const focusTy = isSelected ? focusOffset.y : 0;
              const driftSeed = hashString(`${word.text}-${Math.round(word.x)}-${Math.round(word.y)}`);
              const driftRand = seededRandom(driftSeed);
              const driftScale = isSelected ? 0.5 : 1;
              const fx = (driftRand() - 0.5) * 20 * driftScale;
              const fy = (driftRand() - 0.5) * 18 * driftScale;
              const dur = (14 + driftRand() * 10 + (isSelected ? 6 : 0)).toFixed(2);
              const baseColor = `rgba(var(--word-base), ${alpha})`;
              return (
                <span
                  key={`${word.text}-${word.x}-${word.y}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setAnchor({ x: word.x, y: word.y });
                    onSelect?.(word.text);
                    clickGuardRef.current = Date.now();
                  }}
                  className={`absolute select-none transition-[transform,opacity,color] duration-1000 ease-out ${
                    isSelected ? "font-semibold wordcloud-selected" : ""
                  }`}
                  style={{
                    left: word.x,
                    top: word.y,
                    transform: `translate(-50%, -50%) translate(${tx + focusTx}px, ${ty + focusTy}px)`,
                    opacity: isSelected ? 1 : alpha,
                    color: isSelected ? "var(--word-selected)" : baseColor,
                    pointerEvents: isDimmed ? "none" : "auto",
                    transitionDuration: selectedWord ? "2200ms" : "1200ms",
                  }}
                >
                  <span
                    className="word-float"
                    style={
                      {
                        fontSize: `${word.size}px`,
                        "--fx": `${fx}px`,
                        "--fy": `${fy}px`,
                        "--dur": `${dur}s`,
                        "--rot": `${word.rotate}deg`,
                      } as React.CSSProperties
                    }
                  >
                    {word.text}
                  </span>
                </span>
              );
            })}
          </div>
          <div className="absolute left-6 top-12 z-30 text-[10px] text-[var(--accent)]/80 pointer-events-none">
            <span className="text-[10px] uppercase tracking-[0.3em]">高频词</span>
          </div>
        </>
      )}
      {selectedWord && snippetNodes.length > 0 ? (
        <div className="absolute inset-0 z-40 pointer-events-none">
          {snippetNodes.map((snippet, index) => (
            <div
              key={`${selectedWord}-snippet-${index}`}
              className={`absolute font-semibold leading-7 snippet-enter snippet-drift ${
                snippet.wrap ? "whitespace-normal break-words" : "whitespace-nowrap"
              }`}
              style={{
                left: snippet.x,
                top: snippet.y,
                width: snippet.wrap ? `${Math.min(snippet.w, size.width * 0.86)}px` : `${snippet.w}px`,
                transform: "translate(-50%, -50%)",
                textShadow: "0 4px 14px rgba(18,18,18,0.18)",
                animationDelay: `${index * 120}ms`,
                fontSize: `${snippet.size}px`,
                color: "rgba(var(--word-base), 0.96)",
              }}
            >
              <span>{highlightSnippet(snippet.line, selectedWord)}</span>
              {snippet.title ? (
                <span className="snippet-source block mt-1 text-right">— {snippet.title}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <style jsx global>{`
        .font-poetic {
          font-family: "STKaiti", "Kaiti SC", "KaiTi", "KaiTi_GB2312", "Noto Serif SC",
            "Source Han Serif SC", "STSong", "Songti SC", "SimSun", serif;
          font-kerning: normal;
        }

        .wordcloud-root {
          text-rendering: optimizeLegibility;
          -webkit-font-smoothing: antialiased;
        }

        .wordcloud-gradient {
          background: radial-gradient(circle at 28% 18%, var(--wc-grad-1), transparent 62%),
            radial-gradient(circle at 78% 78%, var(--wc-grad-2), transparent 58%),
            radial-gradient(circle at 50% 50%, var(--wc-grad-3), var(--wc-grad-4)),
            linear-gradient(120deg, var(--bg-grad-1), var(--bg-grad-2));
          background-size: 180% 180%;
          animation: mistMove 36s ease-in-out infinite;
        }

        .wordcloud-noise {
          background-image: radial-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px),
            radial-gradient(rgba(0, 0, 0, 0.04) 1px, transparent 1px);
          background-size: 90px 90px, 140px 140px;
          background-position: 0 0, 40px 60px;
          opacity: 0.2;
          mix-blend-mode: soft-light;
        }

        .wordcloud-selected {
          text-shadow: var(--word-glow-1), var(--word-glow-2);
        }

        .word-float {
          display: inline-block;
          animation: wordFloat var(--dur) ease-in-out infinite;
          transform: translate3d(0, 0, 0) rotate(var(--rot));
          will-change: transform;
        }

        @keyframes wordFloat {
          0% {
            transform: translate3d(0, 0, 0) rotate(var(--rot));
          }
          50% {
            transform: translate3d(var(--fx), var(--fy), 0) rotate(var(--rot));
          }
          100% {
            transform: translate3d(0, 0, 0) rotate(var(--rot));
          }
        }

        @keyframes mistMove {
          0% {
            background-position: 0% 30%;
          }
          50% {
            background-position: 100% 60%;
          }
          100% {
            background-position: 0% 30%;
          }
        }

        .snippet-mark {
          color: var(--accent);
          font-weight: 700;
        }

        .snippet-source {
          color: var(--muted);
          font-weight: 600;
          font-size: 12px;
          white-space: nowrap;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .snippet-enter {
          animation: snippet-enter 820ms cubic-bezier(0.16, 0.64, 0.3, 1) both;
        }

        .snippet-drift {
          animation: snippet-float 24s ease-in-out infinite;
        }

        @keyframes snippet-enter {
          0% {
            opacity: 0;
            transform: translate(-50%, -50%) translate3d(0, 18px, 0) scale(0.96);
            filter: blur(2px);
          }
          55% {
            opacity: 0.8;
            transform: translate(-50%, -50%) translate3d(0, -2px, 0) scale(1.01);
            filter: blur(0.5px);
          }
          100% {
            opacity: 1;
            transform: translate(-50%, -50%) translate3d(0, 0, 0) scale(1);
            filter: blur(0);
          }
        }

        @keyframes snippet-float {
          0% {
            transform: translate(-50%, -50%) translate3d(0, 0, 0);
          }
          50% {
            transform: translate(-50%, -50%) translate3d(-10px, -12px, 0);
          }
          100% {
            transform: translate(-50%, -50%) translate3d(0, 0, 0);
          }
        }

      `}</style>
    </div>
  );
}
