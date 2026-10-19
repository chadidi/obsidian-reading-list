import bplist from 'bplist-parser';
import type { Logger } from '../logger';
import { ReadingListSourceError, errorMessage } from '../errors';
import type { ReadingListEntry } from '../types';
import { isImportableUrl, readFileOrThrow } from './common';

type PlistDict = Record<string, unknown>;

const FULL_DISK_ACCESS_HINT =
  'macOS protects ~/Library/Safari. Grant Obsidian access in System Settings → Privacy & Security → ' +
  'Full Disk Access, then restart Obsidian.';

/** Title of the synthetic list Safari uses to store the reading list inside Bookmarks.plist. */
const READING_LIST_TITLE = 'com.apple.ReadingList';

function isDict(value: unknown): value is PlistDict {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

/** Minimal XML plist reader (Safari's file is binary, but users may point at an exported XML copy). */
function parseXmlPlistNode(el: Element): unknown {
  switch (el.tagName) {
    case 'dict': {
      const obj: PlistDict = {};
      const kids = Array.from(el.children);
      for (let i = 0; i + 1 < kids.length; i += 2) {
        const keyEl = kids[i];
        const valEl = kids[i + 1];
        if (keyEl && valEl) {
          obj[keyEl.textContent ?? ''] = parseXmlPlistNode(valEl);
        }
      }
      return obj;
    }
    case 'array':
      return Array.from(el.children).map(parseXmlPlistNode);
    case 'string':
      return el.textContent ?? '';
    case 'integer':
      return parseInt(el.textContent ?? '0', 10);
    case 'real':
      return parseFloat(el.textContent ?? '0');
    case 'true':
      return true;
    case 'false':
      return false;
    case 'date':
      return new Date(el.textContent ?? '');
    default:
      return el.textContent ?? null; // <data> etc.
  }
}

function parseXmlPlist(xml: string): PlistDict {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML plist is malformed');
  const root = doc.querySelector('plist > dict');
  if (!root) throw new Error('XML plist has no root <dict>');
  const parsed = parseXmlPlistNode(root);
  if (!isDict(parsed)) throw new Error('XML plist root is not a dictionary');
  return parsed;
}

function parsePlist(buffer: Buffer): PlistDict {
  if (buffer.subarray(0, 6).toString('latin1') === 'bplist') {
    // bplist-parser caps files at 32 768 objects by default; a big reading list exceeds that.
    bplist.maxObjectCount = 50_000_000;
    const parsed = bplist.parseBuffer(buffer);
    const root = parsed[0];
    if (!isDict(root)) throw new Error('binary plist root is not a dictionary');
    return root;
  }
  return parseXmlPlist(buffer.toString('utf8'));
}

/** Turns a reading-list leaf (or proxy) node into an entry, or null when it holds no page URL. */
function entryFromNode(node: PlistDict): ReadingListEntry | null {
  const url = node.URLString;
  if (!isImportableUrl(url)) return null;
  const uri = isDict(node.URIDictionary) ? node.URIDictionary : {};
  const title =
    typeof uri.title === 'string' ? uri.title : typeof node.Title === 'string' ? node.Title : '';
  const readingList = isDict(node.ReadingList) ? node.ReadingList : {};
  return {
    sourceId: typeof node.WebBookmarkUUID === 'string' ? node.WebBookmarkUUID : '',
    title: title.trim(),
    url: url.trim(),
    dateAdded: readingList.DateAdded instanceof Date ? readingList.DateAdded : null,
    excerpt: typeof readingList.PreviewText === 'string' ? readingList.PreviewText : '',
    read: null, // Safari does not track a read state for reading-list items
    browser: 'safari',
  };
}

/** Collects every item inside the reading list (including any subfolders it may contain). */
function collectItems(list: PlistDict, out: ReadingListEntry[]): void {
  if (!Array.isArray(list.Children)) return;
  for (const child of list.Children) {
    if (!isDict(child)) continue;
    const entry = entryFromNode(child);
    if (entry) out.push(entry);
    if (Array.isArray(child.Children)) collectItems(child, out);
  }
}

/** Walks the bookmark tree looking for the reading-list folder. */
function findReadingList(node: PlistDict, out: ReadingListEntry[]): boolean {
  if (!Array.isArray(node.Children)) return false;
  for (const child of node.Children) {
    if (!isDict(child)) continue;
    if (child.WebBookmarkType !== 'WebBookmarkTypeList') continue;
    if (typeof child.Title === 'string' && child.Title === READING_LIST_TITLE) {
      collectItems(child, out);
      return true;
    }
    if (findReadingList(child, out)) return true;
  }
  return false;
}

export async function readSafariReadingList(
  filePath: string,
  log: Logger,
): Promise<ReadingListEntry[]> {
  const buffer = await readFileOrThrow(filePath, { permission: FULL_DISK_ACCESS_HINT });
  return parseSafariReadingList(buffer, log, filePath);
}

/**
 * Parses Safari bookmark bytes into reading-list entries. Kept separate from the file read so bytes
 * obtained through the native file picker (a session-only, user-granted read) can be parsed the same
 * way.
 */
export function parseSafariReadingList(
  buffer: Buffer,
  log: Logger,
  label = 'the selected file',
): ReadingListEntry[] {
  let root: PlistDict;
  try {
    root = parsePlist(buffer);
  } catch (err) {
    throw new ReadingListSourceError(
      `Could not parse ${label} as a Safari Bookmarks.plist: ${errorMessage(err)}`,
      err,
    );
  }

  const out: ReadingListEntry[] = [];
  if (!findReadingList(root, out)) {
    log.info(`Safari: no reading list found in ${label}`);
  }
  log.debug(`Safari: parsed ${out.length} reading-list items`);
  return out;
}
