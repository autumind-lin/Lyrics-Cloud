const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export type HighlightResult = {
  snippet: string;
  html: string;
  leadingEllipsis: boolean;
  trailingEllipsis: boolean;
};

export const buildHighlightSnippet = (
  text: string,
  query: string,
  radius = 26,
  fallbackLength = 70
): HighlightResult => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return { snippet: "", html: "", leadingEllipsis: false, trailingEllipsis: false };
  }

  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    const snippet = normalized.slice(0, fallbackLength);
    return {
      snippet,
      html: escapeHtml(snippet),
      leadingEllipsis: false,
      trailingEllipsis: normalized.length > snippet.length,
    };
  }

  const hitIndex = normalized.toLowerCase().indexOf(trimmedQuery.toLowerCase());
  if (hitIndex === -1) {
    const snippet = normalized.slice(0, fallbackLength);
    return {
      snippet,
      html: escapeHtml(snippet),
      leadingEllipsis: false,
      trailingEllipsis: normalized.length > snippet.length,
    };
  }

  const start = Math.max(0, hitIndex - radius);
  const end = Math.min(normalized.length, hitIndex + trimmedQuery.length + radius);
  const snippet = normalized.slice(start, end);
  const hitStart = hitIndex - start;
  const before = escapeHtml(snippet.slice(0, hitStart));
  const match = escapeHtml(snippet.slice(hitStart, hitStart + trimmedQuery.length));
  const after = escapeHtml(snippet.slice(hitStart + trimmedQuery.length));

  return {
    snippet,
    html: `${before}<mark>${match}</mark>${after}`,
    leadingEllipsis: start > 0,
    trailingEllipsis: end < normalized.length,
  };
};
