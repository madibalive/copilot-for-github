import { minimatch } from "minimatch";
import type { IncludeExclude } from "../types.js";

/** Well-known bot usernames excluded by default when no explicit author filters are set. */
export const KNOWN_BOTS = ["dependabot[bot]", "renovate[bot]", "github-actions[bot]"];

export interface KeywordFilters {
  skipKeywords?: string[];
  includeKeywords?: string[];
}

/** Exact match, no glob. Returns true if PR author passes the filter. */
export function passesAuthorFilter(author: string, filters?: IncludeExclude): boolean {
  if (!filters) return true;
  const { include = [], exclude = [] } = filters;
  if (include.length > 0 && !include.includes(author)) return false;
  if (exclude.length > 0 && exclude.includes(author)) return false;
  return true;
}

/** Case-insensitive substring match against title + body. */
export function passesKeywordFilter(
  title: string,
  body: string | null,
  filters?: KeywordFilters
): boolean {
  if (!filters) return true;
  const text = `${title} ${body ?? ""}`.toLowerCase();
  if (filters.skipKeywords && filters.skipKeywords.length > 0) {
    if (filters.skipKeywords.some((kw) => text.includes(kw.toLowerCase()))) return false;
  }
  if (filters.includeKeywords && filters.includeKeywords.length > 0) {
    if (!filters.includeKeywords.some((kw) => text.includes(kw.toLowerCase()))) return false;
  }
  return true;
}

/** Minimatch glob match against a branch ref (head or base). */
export function passesBranchFilter(ref: string, filters?: IncludeExclude): boolean {
  if (!filters) return true;
  const { include = [], exclude = [] } = filters;
  if (include.length > 0 && !include.some((p) => minimatch(ref, p))) return false;
  if (exclude.length > 0 && exclude.some((p) => minimatch(ref, p))) return false;
  return true;
}

/** Exact label match. Returns true if PR labels pass the filter. */
export function passesLabelFilter(labels: string[], filters?: IncludeExclude): boolean {
  if (!filters) return true;
  const { include = [], exclude = [] } = filters;
  if (include.length > 0 && !include.some((l) => labels.includes(l))) return false;
  if (exclude.length > 0 && exclude.some((l) => labels.includes(l))) return false;
  return true;
}
