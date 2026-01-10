"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type WordItem = {
  text: string;
  value: number;
};

type WordCloudProps = {
  words: WordItem[];
  maxWords?: number;
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
    line: string;
    title?: string;
    wrap: boolean;
  }> = [];
  const minDist = verticalSpread ? 110 : 140;
  const minCenterDist = verticalSpread ? 170 : 200;
  const padding = 40;
  const lineHeight = fontSize * 1.45;
  const boxHeight = allowWrap ? lineHeight * 2.1 : lineHeight;
  const gap = allowWrap ? 10 : 16;
  const maxWidth = Math.min(width - padding * 2, allowWrap ? width * 0.86 : 520);
  const centerBox = { w: 220, h: 140 };
  for (let i = 0; i < snippets.length; i += 1) {
    const text = snippets[i].line;
    const title = snippets[i].title ? ` — ${snippets[i].title}` : "";
    const estimatedWidth = Math.min(
      maxWidth,
      Math.max(180, Math.min(maxWidth, (text.length + title.length) * fontSize * 0.62))
    );
    const needsWrap = allowWrap && estimatedWidth > maxWidth * 0.92;
    let angle = rand() * Math.PI * 2;
    let radius = 160 + rand() * 90 + i * 22;
    let x = centerX + radius * Math.cos(angle);
    let y = centerY + radius * Math.sin(angle);
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
    while (attempts < 14) {
      const tooClose =
        Math.hypot(x - centerX, y - centerY) < minCenterDist ||
        (Math.abs(x - centerX) < centerBox.w / 2 + estimatedWidth / 2 + gap &&
          Math.abs(y - centerY) < centerBox.h / 2 + boxHeight / 2 + gap) ||
        placed.some((p) => {
          const overlapX = Math.abs(p.x - x) < p.w / 2 + estimatedWidth / 2 + gap;
          const overlapY = Math.abs(p.y - y) < p.h / 2 + boxHeight / 2 + gap;
          return overlapX && overlapY;
        }) ||
        placed.some((p) => Math.hypot(p.x - x, p.y - y) < minDist);
      if (!tooClose) {
        placedOk = true;
        break;
      }
      radius += 26;
      angle += 2.3999632297;
      x = centerX + radius * Math.cos(angle);
      y = centerY + radius * Math.sin(angle);
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
  selectedWord,
  snippets = [],
  onSelect,
  onClear,
}: WordCloudProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const highlightCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [selectedBox, setSelectedBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const clickGuardRef = useRef(0);
  const anchorRef = useRef<{ x: number; y: number } | null>(null);
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
  const isPortrait = size.height > size.width;
  const snippetFontSize = isCompact ? 18 : 21;
  const allowWrap = isCompact;
  const verticalSpread = isCompact && isPortrait;
  const snippetNodes = useMemo(() => {
    if (!selectedWord || snippets.length === 0 || !size.width || !size.height) return [];
    const centerX = selectedBox ? selectedBox.x + selectedBox.w / 2 : anchor?.x ?? size.width / 2;
    const centerY = selectedBox ? selectedBox.y + selectedBox.h / 2 : anchor?.y ?? size.height / 2;
    const maxSnippets = size.width < 720 ? 6 : 6;
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
    selectedBox,
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

  useEffect(() => {
    const canvas = particleCanvasRef.current;
    if (!canvas || !size.width || !size.height) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ratio = window.devicePixelRatio || 1;
    const scale = 0.75;
    canvas.width = Math.floor(size.width * ratio * scale);
    canvas.height = Math.floor(size.height * ratio * scale);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0);

    const count = Math.min(1800, Math.max(900, Math.round((size.width * size.height) / 2200)));
    const particles = Array.from({ length: count }, () => ({
      x: Math.random() * size.width,
      y: Math.random() * size.height,
      r: 0.9 + Math.random() * 1.8,
      a: 0.22 + Math.random() * 0.35,
      vx: (Math.random() - 0.5) * 0.14,
      vy: (Math.random() - 0.5) * 0.14,
    }));

    let raf = 0;
    let last = 0;
    const fps = reducedMotion ? 8 : 24;

    const tick = (time: number) => {
      raf = window.requestAnimationFrame(tick);
      if (document.hidden) return;
      if (time - last < 1000 / fps) return;
      last = time;
      ctx.clearRect(0, 0, size.width, size.height);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -10) p.x = size.width + 10;
        if (p.x > size.width + 10) p.x = -10;
        if (p.y < -10) p.y = size.height + 10;
        if (p.y > size.height + 10) p.y = -10;
        ctx.beginPath();
        ctx.fillStyle = `rgba(248, 240, 232, ${p.a})`;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [size.width, size.height]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const handlePointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      anchorRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };
    canvas.addEventListener("pointerdown", handlePointer);
    return () => {
      canvas.removeEventListener("pointerdown", handlePointer);
    };
  }, [size.width, size.height, trimmedWords.length]);

  useEffect(() => {
    const canvas = highlightCanvasRef.current;
    if (!canvas || !size.width || !size.height) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.width * ratio);
    canvas.height = Math.floor(size.height * ratio);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    if (!selectedWord || !selectedBox) return;
    ctx.fillStyle = "rgba(14, 10, 8, 0.2)";
    ctx.fillRect(0, 0, size.width, size.height);
    const fontSize = Math.max(16, Math.min(selectedBox.h * 1.1, 72));
    ctx.font =
      `700 ${fontSize}px "Noto Serif SC","Source Han Serif SC","STSong","Songti SC","SimSun",serif`;
    ctx.fillStyle = "rgba(252, 246, 238, 0.96)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const cx = selectedBox.x + selectedBox.w / 2;
    const cy = selectedBox.y + selectedBox.h / 2;
    ctx.fillText(selectedWord, cx, cy);
  }, [selectedWord, selectedBox, size.width, size.height]);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (!size.width || !size.height) return;
    if (trimmedWords.length === 0) return;
    let cancelled = false;
    setError(null);
    const renderKey = `${wordsKey}|${size.width}x${size.height}`;
    if (renderKey === lastRenderKeyRef.current) return;
    lastRenderKeyRef.current = renderKey;
    const seed = hashString(`${wordsKey}|${size.width}x${size.height}`);

    const timer = window.setTimeout(() => {
      const run = async () => {
        try {
          const module = await import("wordcloud");
          if (cancelled || !canvasRef.current) return;
          const WordCloud = module.default ?? module;
          const canvas = canvasRef.current;
          const ratio = window.devicePixelRatio || 1;
          canvas.width = Math.floor(size.width * ratio);
          canvas.height = Math.floor(size.height * ratio);
          canvas.style.width = `${size.width}px`;
          canvas.style.height = `${size.height}px`;
          const list = trimmedWords.map((item) => [item.text, item.value]);
          const maxValue = Math.max(...list.map((item) => item[1]), 1);
          const minValue = Math.min(...list.map((item) => item[1]), maxValue);
          const range = Math.max(1, maxValue - minValue);
          const { min, max } = fontRangeRef.current;
          const containerArea = size.width * size.height;
          const estimatedArea = list.reduce((sum, [text, value]) => {
            const normalized =
              Math.log1p(Math.max(0, value - minValue)) / Math.log1p(range + 1);
            const fontSize = min + (max - min) * Math.sqrt(Math.max(0, normalized));
            const widthEstimate = Math.max(1, text.length) * fontSize * 0.6 + 8;
            const heightEstimate = fontSize * 1.25;
            return sum + widthEstimate * heightEstimate;
          }, 0);
          const targetCoverage = 0.85;
          const coverage = containerArea ? estimatedArea / containerArea : 0.3;
          const scaleBoost = Math.min(
            5,
            Math.max(0.95, Math.sqrt(targetCoverage / Math.max(0.05, coverage)))
          );

          WordCloud(canvas, {
            list,
            backgroundColor: "rgba(0,0,0,0)",
            gridSize: Math.max(6, Math.round(size.width / 140)) * ratio,
            weightFactor: (weight: number) => {
              const normalized =
                Math.log1p(Math.max(0, weight - minValue)) / Math.log1p(range + 1);
              return (min + (max - min) * Math.sqrt(Math.max(0, normalized))) * scaleBoost * ratio;
            },
            fontFamily:
              '"Noto Serif SC","Source Han Serif SC","STSong","Songti SC","SimSun",serif',
            fontWeight: () => "400",
            color: (word: string, weight: number) => {
              const normalized =
                Math.log1p(Math.max(0, weight - minValue)) / Math.log1p(range + 1);
              const alpha = 0.45 + Math.min(0.4, Math.max(0, normalized) * 0.4);
              return `rgba(28,24,22,${alpha})`;
            },
            rotateRatio: 0,
            rotationSteps: 1,
            shuffle: false,
            random: seededRandom(seed),
            drawOutOfBound: false,
            clearCanvas: true,
            origin: [Math.floor((size.width * ratio) / 2), Math.floor((size.height * ratio) / 2)],
            shrinkToFit: false,
            shape: "square",
            spiral: "rectangular",
            click: (item: [string, number], dimension?: number[]) => {
              if (!item) return;
              const center = { x: size.width / 2, y: size.height / 2 };
              let nextAnchor: { x: number; y: number } | null = null;
              const estimateBox = (anchorPoint: { x: number; y: number }) => {
                const fontSize = Math.max(16, Math.min(fontRangeRef.current.max, 72));
                const widthEstimate = Math.max(60, item[0].length * fontSize * 0.7 + 12);
                const heightEstimate = fontSize * 1.2;
                return {
                  x: anchorPoint.x - widthEstimate / 2,
                  y: anchorPoint.y - heightEstimate / 2,
                  w: widthEstimate,
                  h: heightEstimate,
                };
              };
              if (Array.isArray(dimension) && dimension.length >= 4) {
                const centerX = (dimension[0] + dimension[2] / 2) / ratio;
                const centerY = (dimension[1] + dimension[3] / 2) / ratio;
                if (Number.isFinite(centerX) && Number.isFinite(centerY)) {
                  nextAnchor = { x: centerX, y: centerY };
                  setSelectedBox({
                    x: dimension[0] / ratio,
                    y: dimension[1] / ratio,
                    w: dimension[2] / ratio,
                    h: dimension[3] / ratio,
                  });
                }
              }
              if (!nextAnchor) {
                const fallback =
                  anchorRef.current &&
                  Number.isFinite(anchorRef.current.x) &&
                  Number.isFinite(anchorRef.current.y)
                    ? anchorRef.current
                    : center;
                nextAnchor = fallback;
                setSelectedBox(estimateBox(nextAnchor));
              }
              setAnchor(nextAnchor);
              onSelect?.(item[0]);
              clickGuardRef.current = Date.now();
            },
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : "wordcloud_error");
        }
      };

      run();
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [size.width, size.height, trimmedWords]);

  const isReady = size.width > 0 && size.height > 0;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden font-poetic"
      onClick={() => {
        if (Date.now() - clickGuardRef.current < 200) {
          return;
        }
        setAnchor(null);
        setSelectedBox(null);
        onClear?.();
      }}
    >
      <div className="absolute inset-0 z-0 wordcloud-gradient pointer-events-none" />
      <canvas ref={particleCanvasRef} className="absolute inset-0 z-[2] pointer-events-none" />
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
            className={`absolute inset-0 z-10 transition-opacity duration-500 ${
              selectedWord ? "wordcloud-drift opacity-65" : "opacity-100"
            }`}
          >
            <canvas ref={canvasRef} className="absolute inset-0 cursor-pointer pointer-events-auto" />
          </div>
          <canvas ref={highlightCanvasRef} className="absolute inset-0 z-20 pointer-events-none" />
          <div className="absolute right-4 top-4 z-30 flex flex-wrap items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs text-[var(--muted)] shadow-sm pointer-events-auto">
            <span>高频词</span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setShowAll((prev) => !prev);
              }}
              className="rounded-full border border-[var(--accent)]/30 px-2 py-0.5 text-[10px] text-[var(--accent)]"
            >
              {showAll ? "收起" : "更多"}
            </button>
          </div>
        </>
      )}
      {selectedWord && snippetNodes.length > 0 ? (
        <div className="absolute inset-0 z-40 pointer-events-none">
          <div className="absolute left-1/2 top-1/2 z-40 h-56 w-56 -translate-x-1/2 -translate-y-1/2">
            <span className="ripple-ring ripple-ring-1" />
            <span className="ripple-ring ripple-ring-2" />
            <span className="ripple-ring ripple-ring-3" />
          </div>
          {snippetNodes.map((snippet, index) => (
            <div
              key={`${selectedWord}-snippet-${index}`}
              className={`absolute font-semibold leading-7 text-[rgba(24,18,16,0.97)] ${
                isCompact ? "text-[18px]" : "text-[21px]"
              } ${
                snippet.wrap ? "whitespace-normal break-words" : "whitespace-nowrap"
              }`}
              style={{
                left: snippet.x,
                top: snippet.y,
                width: snippet.wrap ? `${Math.min(snippet.w, size.width * 0.86)}px` : `${snippet.w}px`,
                transform: "translate(-50%, -50%)",
                textShadow: "0 8px 22px rgba(28,18,12,0.4)",
                filter: "drop-shadow(0 2px 12px rgba(18,12,8,0.24))",
                animation: "snippet-float 20s ease-in-out infinite",
                animationDelay: `${index * 120}ms`,
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
          font-family: "Noto Serif SC", "Source Han Serif SC", "STSong", "Songti SC", "SimSun",
            serif;
        }

        .wordcloud-gradient {
          background: radial-gradient(circle at 30% 20%, rgba(238, 216, 195, 0.3), transparent 60%),
            radial-gradient(circle at 70% 80%, rgba(214, 190, 172, 0.28), transparent 55%),
            radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 0), rgba(20, 14, 12, 0.18)),
            linear-gradient(120deg, rgba(234, 218, 202, 0.78), rgba(218, 200, 184, 0.8));
          background-size: 180% 180%;
          animation: mistMove 36s ease-in-out infinite;
        }

        .wordcloud-drift {
          animation: cloudDrift 18s ease-in-out infinite;
          filter: blur(0.35px);
        }

        @keyframes cloudDrift {
          0% {
            transform: translate3d(0, 0, 0) scale(1);
          }
          50% {
            transform: translate3d(-6px, -8px, 0) scale(0.985);
          }
          100% {
            transform: translate3d(0, 0, 0) scale(1);
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
          color: rgba(150, 76, 34, 0.98);
          font-weight: 700;
        }

        .snippet-source {
          color: rgba(80, 68, 60, 0.7);
          font-weight: 600;
          font-size: 12px;
          white-space: nowrap;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .ripple-ring {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          border: 1px solid rgba(210, 176, 142, 0.45);
          box-shadow: 0 0 40px rgba(210, 176, 142, 0.22);
          opacity: 0;
          transform: scale(0.4);
          animation: rippleExpand 6s ease-out infinite;
        }

        .ripple-ring-2 {
          animation-delay: 1.6s;
        }

        .ripple-ring-3 {
          animation-delay: 3.2s;
        }

        @keyframes rippleExpand {
          0% {
            opacity: 0.25;
            transform: scale(0.35);
          }
          70% {
            opacity: 0;
            transform: scale(1.05);
          }
          100% {
            opacity: 0;
            transform: scale(1.1);
          }
        }
      `}</style>
    </div>
  );
}
