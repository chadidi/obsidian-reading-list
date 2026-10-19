import type { Logger } from '../logger';
import { ReadingListSourceError } from '../errors';
import { BROWSER_LABELS, type BrowserType, type ReadingListEntry } from '../types';
import { isImportableUrl, readFileOrThrow } from './common';

interface ChromeReadingListItem {
  url?: string;
  title?: string;
  /** Microseconds since the Unix epoch (Chrome's base::Time), as a number or string. */
  creation_time_us?: number | string;
  has_been_read?: boolean;
}

/** Chrome stores reading-list timestamps as microseconds since the Unix epoch. */
function unixMicrosToDate(value: number | string | undefined): Date | null {
  const micros = Number(value);
  if (!Number.isFinite(micros) || micros <= 0) return null;
  const ms = micros / 1000;
  return ms > 0 ? new Date(ms) : null;
}

/**
 * Reads the reading list of a Chromium-based browser (Chrome, Chromium, Brave, Edge...).
 * The reading list is a JSON file named "Reading List" in the browser's profile directory,
 * with a top-level "reading_list" array.
 */
export async function readChromeReadingList(
  filePath: string,
  log: Logger,
  browser: BrowserType = 'chrome',
): Promise<ReadingListEntry[]> {
  const buffer = await readFileOrThrow(filePath);

  let doc: { reading_list?: unknown };
  try {
    doc = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, '')) as { reading_list?: unknown };
  } catch (err) {
    throw new ReadingListSourceError(
      `${filePath} is not valid JSON. Is it really a Chrome/Chromium "Reading List" file?`,
      err,
    );
  }
  if (!Array.isArray(doc.reading_list)) {
    throw new ReadingListSourceError(
      `${filePath} has no "reading_list" array; unsupported Reading List file layout.`,
    );
  }

  const out: ReadingListEntry[] = [];
  for (const raw of doc.reading_list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as ChromeReadingListItem;
    if (!isImportableUrl(item.url)) continue;
    out.push({
      sourceId: '',
      title: (item.title ?? '').trim(),
      url: item.url.trim(),
      dateAdded: unixMicrosToDate(item.creation_time_us),
      excerpt: '',
      read: typeof item.has_been_read === 'boolean' ? item.has_been_read : null,
      browser,
    });
  }
  log.debug(`${BROWSER_LABELS[browser]}: parsed ${out.length} reading-list items`);
  return out;
}
