import type { TrackRecord } from "./schema";

export type BigramToken = {
  token: string;
  count: number;
};

const stopWords = new Set([
  "我们",
  "你们",
  "他们",
  "她们",
  "它们",
  "自己",
  "一个",
  "没有",
  "然后",
  "因为",
  "所以",
  "但是",
  "如果",
  "只是",
  "就是",
  "还是",
  "已经",
  "现在",
  "过去",
  "未来",
  "这样",
  "那样",
  "这里",
  "那里",
  "什么",
  "怎么",
  "可以",
  "不会",
  "是否",
  "可能",
  "不要",
  "不要",
  "真的",
  "真的",
]);

const stopChars = new Set([
  "的",
  "了",
  "在",
  "是",
  "我",
  "你",
  "他",
  "她",
  "它",
  "也",
  "和",
  "与",
  "或",
  "而",
  "啊",
  "哦",
  "吗",
  "呢",
  "吧",
  "呀",
  "这",
  "那",
  "就",
  "都",
  "被",
  "让",
  "为",
  "有",
  "无",
  "不",
  "没",
  "可",
  "很",
  "再",
  "又",
  "并",
  "但",
  "却",
  "且",
  "也",
  "与",
  "其",
  "之",
  "、",
  "。",
  "，",
  "！",
  "？",
  "；",
  "：",
  "“",
  "”",
  "《",
  "》",
  "（",
  "）",
  "【",
  "】",
  "—",
  "-",
  "_",
  " ",
  "\n",
  "\t",
]);

const isValidChar = (char: string) => {
  if (stopChars.has(char)) {
    return false;
  }
  return /[\u4e00-\u9fa5]/.test(char);
};

const isPunctuation = (value: string) => /[。，！？；：、“”《》【】（）—…\-_]/.test(value);

export const segmentWords = (text: string): string[] => {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("zh-Hans", { granularity: "word" });
    const results: string[] = [];
    for (const segment of segmenter.segment(text)) {
      const token = segment.segment.trim();
      if (!token) continue;
      if (token.length < 2) continue;
      if (isPunctuation(token)) continue;
      if (stopWords.has(token)) continue;
      results.push(token);
    }
    return results;
  }
  return [];
};

export const buildBigramStats = (tracks: TrackRecord[], limit = 20): BigramToken[] => {
  const counts = new Map<string, number>();

  tracks.forEach((track) => {
    const tokens = segmentWords(track.lyrics);
    if (tokens.length) {
      tokens.forEach((token) => {
        counts.set(token, (counts.get(token) ?? 0) + 1);
      });
      return;
    }
    const text = track.lyrics.replace(/\s+/g, "");
    const chars = Array.from(text);
    for (let i = 0; i < chars.length - 1; i += 1) {
      const first = chars[i];
      const second = chars[i + 1];
      if (!isValidChar(first) || !isValidChar(second)) {
        continue;
      }
      const token = `${first}${second}`;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  });

  return Array.from(counts.entries())
    .map(([token, count]) => ({ token, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
};
