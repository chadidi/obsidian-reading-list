import type { Logger } from '../logger';
import { ReadingListSourceError } from '../errors';
import { BROWSER_LABELS, type BrowserType, type ReadingListEntry, isBrowserType } from '../types';
import { isImportableUrl, readFileOrThrow } from './common';

interface ChromeReadingListItem {
  url?: string;
  title?: string;
  /** Microseconds since the Unix epoch (Chrome's base::Time), as a number or string. */
  creation_time_us?: number | string;
  has_been_read?: boolean;
}

interface ChromeBookmarkNode {
  id?: string;
  name?: string;
  type?: string; // 'url' | 'folder'
  url?: string;
  date_added?: string | number;
  children?: ChromeBookmarkNode[];
}

interface ChromeBookmarksDoc {
  roots?: Record<string, ChromeBookmarkNode>;
  reading_list?: unknown;
}

/**
 * Chrome stores bookmark timestamps as microseconds since January 1, 1601 UTC
 * (Windows/WebKit epoch). Difference to Unix epoch (1970-01-01) is 11,644,473,600 seconds.
 */
export function chromeTimestampToDate(value: string | number | undefined): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const raw = typeof value === 'string' ? value.trim() : String(value);
  if (!/^\d+$/.test(raw)) return null;
  try {
    const micros = BigInt(raw);
    if (micros <= 0n) return null;
    const EPOCH_DIFF = 11644473600000000n;
    const unixMicros = micros > EPOCH_DIFF ? micros - EPOCH_DIFF : micros;
    const ms = Number(unixMicros / 1000n);
    return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
  } catch {
    return null;
  }
}

/** Splits "Other Bookmarks/Reading List" into trimmed, lower-case segments. */
function parseFolderSegments(raw: string): string[] {
  return raw
    .split(/[\\/]+/)
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeSegment(s: string): string {
  const lower = s.toLowerCase();
  if (lower === 'other bookmarks' || lower === 'other favorites') {
    return 'other';
  }
  return lower;
}

/**
 * True when `folderPath` contains the configured `wanted` segments as a contiguous run,
 * so bookmarks in "Other Bookmarks" -> "Reading List" or "Other Favorites" -> "Reading List"
 * match "Other Bookmarks/Reading List", "Other Favorites/Reading List", or simply "Reading List".
 */
function folderMatches(folderPath: string[], wanted: string[]): boolean {
  if (wanted.length === 0) return false;
  const lower = folderPath.map(normalizeSegment);
  const target = wanted.map(normalizeSegment);
  for (let i = 0; i + target.length <= lower.length; i++) {
    let matches = true;
    for (let j = 0; j < target.length; j++) {
      if (lower[i + j] !== target[j]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function walkBookmarkNodes(
  nodes: ChromeBookmarkNode[],
  trail: string[],
  wanted: string[],
  out: ReadingListEntry[],
  browser: BrowserType,
): void {
  for (const node of nodes) {
    if (node.type === 'url' || (node.url && typeof node.url === 'string')) {
      if (!isImportableUrl(node.url)) continue;
      if (!folderMatches(trail, wanted)) continue;
      out.push({
        sourceId: String(node.id ?? ''),
        title: (node.name ?? '').trim(),
        url: node.url.trim(),
        dateAdded: chromeTimestampToDate(node.date_added),
        excerpt: '',
        read: null,
        browser,
      });
    } else if (node.type === 'folder' || Array.isArray(node.children)) {
      const name = (node.name ?? '').trim();
      walkBookmarkNodes(
        node.children ?? [],
        name ? [...trail, name] : trail,
        wanted,
        out,
        browser,
      );
    }
  }
}

/**
 * Reads the reading list of a Chromium-based browser (Chrome, Chromium, Brave, Edge...).
 * Supports:
 * 1. The native Chrome/Chromium "Bookmarks" (or "AccountBookmarks") JSON file, filtering by
 *    the configured folder (defaults to "Other Bookmarks/Reading List").
 * 2. An exported JSON file containing a top-level "reading_list" array.
 */
export async function readChromeReadingList(
  filePath: string,
  log: Logger,
  folderOrBrowser: string = 'Other Bookmarks/Reading List',
  browserArg: BrowserType = 'chrome',
): Promise<ReadingListEntry[]> {
  let folder = 'Other Bookmarks/Reading List';
  let browser: BrowserType = browserArg;

  if (isBrowserType(folderOrBrowser)) {
    browser = folderOrBrowser;
  } else {
    folder = folderOrBrowser;
  }

  const buffer = await readFileOrThrow(filePath);

  let doc: ChromeBookmarksDoc;
  try {
    doc = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, '')) as ChromeBookmarksDoc;
  } catch (err) {
    throw new ReadingListSourceError(
      `${filePath} is not valid JSON. Is it really a Chrome/Chromium Bookmarks file?`,
      err,
    );
  }

  // 1. Native Bookmarks JSON format (has roots: { bookmark_bar: ..., other: ..., synced: ... })
  if (doc.roots && typeof doc.roots === 'object') {
    const wanted = parseFolderSegments(folder);
    if (wanted.length === 0) {
      log.warn(`${BROWSER_LABELS[browser]} reading-list folder is empty; nothing to import`);
      return [];
    }

    const out: ReadingListEntry[] = [];
    for (const [key, root] of Object.entries(doc.roots)) {
      if (!root || typeof root !== 'object') continue;
      const rootName = (root.name ?? '').trim() || key;
      walkBookmarkNodes(root.children ?? [], [rootName], wanted, out, browser);
    }

    log.debug(
      `${BROWSER_LABELS[browser]}: parsed ${out.length} bookmarks from folder "${folder}"`,
    );
    return out;
  }

  // 2. Exported reading list JSON format (has top-level reading_list array)
  if (Array.isArray(doc.reading_list)) {
    const out: ReadingListEntry[] = [];
    for (const raw of doc.reading_list) {
      if (typeof raw !== 'object' || raw === null) continue;
      const item = raw as ChromeReadingListItem;
      if (!isImportableUrl(item.url)) continue;
      out.push({
        sourceId: '',
        title: (item.title ?? '').trim(),
        url: item.url.trim(),
        dateAdded: chromeTimestampToDate(item.creation_time_us),
        excerpt: '',
        read: typeof item.has_been_read === 'boolean' ? item.has_been_read : null,
        browser,
      });
    }
    log.debug(`${BROWSER_LABELS[browser]}: parsed ${out.length} reading-list items`);
    return out;
  }

  throw new ReadingListSourceError(
    `${filePath} does not contain Chrome bookmarks (no "roots" object) or a "reading_list" array.`,
  );
}
