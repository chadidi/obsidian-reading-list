import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Logger } from '../logger';
import { ReadingListSourceError, errorMessage } from '../errors';
import type { ReadingListEntry } from '../types';
import { isImportableUrl, readFileOrThrow, translateFsError } from './common';
import { decodeMozLz4 } from './lz4';

const ROOT_GUID = 'root________';
const TAGS_GUID = 'tags________';
const ROOT_LABELS: Record<string, string> = {
  menu________: 'Bookmarks Menu',
  toolbar_____: 'Bookmarks Toolbar',
  unfiled_____: 'Other Bookmarks',
  mobile______: 'Mobile Bookmarks',
};
/** In JSON backups the special folders are identified by a `root` property instead of a GUID. */
const BACKUP_ROOT_LABELS: Record<string, string> = {
  bookmarksMenuFolder: 'Bookmarks Menu',
  toolbarFolder: 'Bookmarks Toolbar',
  unfiledBookmarksFolder: 'Other Bookmarks',
  mobileFolder: 'Mobile Bookmarks',
};

/** Splits a slash-separated folder setting into lower-cased, non-empty segments. */
function parseFolderSegments(folder: string): string[] {
  return folder
    .split('/')
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * True when `folderPath` contains the configured `wanted` segments as a contiguous run, so a
 * bookmark filed directly in the reading-list folder or anywhere beneath it matches.
 */
function folderMatches(folderPath: string[], wanted: string[]): boolean {
  if (wanted.length === 0) return false;
  const lower = folderPath.map((segment) => segment.toLowerCase());
  for (let i = 0; i + wanted.length <= lower.length; i++) {
    let matches = true;
    for (let j = 0; j < wanted.length; j++) {
      if (lower[i + j] !== wanted[j]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Entry point: SQLite (live) or JSON backup (no extra software)       */
/* ------------------------------------------------------------------ */

/**
 * Firefox has no native reading list, so this reads the bookmarks of the configured bookmark
 * folder (matched by name, anywhere in the tree) and treats them as the reading list.
 */
export async function readFirefoxReadingList(
  sourcePath: string,
  log: Logger,
  folder: string,
): Promise<ReadingListEntry[]> {
  const wanted = parseFolderSegments(folder);
  if (wanted.length === 0) {
    log.warn('Firefox reading-list folder is empty; nothing to import');
    return [];
  }

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(sourcePath);
  } catch (err) {
    throw translateFsError(err, sourcePath);
  }

  if (stat.isDirectory()) {
    const backup = await newestBackupIn(sourcePath);
    if (backup) return readBackupFile(backup, log, wanted);
    const places = path.join(sourcePath, 'places.sqlite');
    if (fs.existsSync(places)) return readPlaces(places, log, wanted);
    throw new ReadingListSourceError(
      `${sourcePath} contains neither places.sqlite nor bookmarks-*.jsonlz4 backups.`,
    );
  }

  const lower = sourcePath.toLowerCase();
  if (lower.endsWith('.jsonlz4') || lower.endsWith('.json'))
    return readBackupFile(sourcePath, log, wanted);
  return readPlaces(sourcePath, log, wanted);
}

/* ------------------------------------------------------------------ */
/* places.sqlite via the SQLite module built into Node (node:sqlite)   */
/* ------------------------------------------------------------------ */

interface PlacesRow {
  id: number;
  parent: number;
  type: number; // 1 bookmark, 2 folder, 3 separator
  title: string | null;
  guid: string;
  dateAdded: number | null; // microseconds since the Unix epoch
  url: string | null;
}

const PLACES_QUERY =
  'SELECT b.id AS id, b.parent AS parent, b.type AS type, b.title AS title, b.guid AS guid, ' +
  'b.dateAdded AS dateAdded, p.url AS url ' +
  'FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk;';

/**
 * Node's built-in SQLite is available unflagged since Node 22.13, which is what Obsidian's
 * Electron ships. It is imported lazily because the module is still experimental and older
 * Electron builds do not have it: a top-level import would fail plugin load instead of only
 * this source.
 */
async function loadSqlite(): Promise<typeof import('node:sqlite')> {
  try {
    // In a bundled CJS environment (Obsidian), require is the most reliable way to load Node builtins.
    // We use a dynamic lookup to avoid linter and bundler issues.
    const req = (window as unknown as Record<string, unknown>)['require'];
    if (typeof req === 'function') {
      return (req as (id: string) => typeof import('node:sqlite'))('node:sqlite');
    }
    return await import('node:sqlite');
  } catch (err) {
    throw new ReadingListSourceError(
      'This Obsidian build does not provide the built-in SQLite module (node:sqlite). ' +
        'Point the Firefox path at a bookmarkbackups *.jsonlz4 file or folder instead.',
      err,
    );
  }
}

async function copyIfExists(from: string, to: string): Promise<void> {
  try {
    await fs.promises.copyFile(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

async function readPlaces(
  dbPath: string,
  log: Logger,
  wanted: string[],
): Promise<ReadingListEntry[]> {
  const { DatabaseSync } = await loadSqlite();

  // Firefox keeps places.sqlite open in WAL mode. Querying it in place can fail with "database is
  // locked" and would miss uncheckpointed changes. We therefore snapshot the database together
  // with its -wal file into a private temp dir; SQLite replays the WAL when opening the copy.
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'obsidian-reading-list-'));
  try {
    const copy = path.join(tmp, 'places.sqlite');
    let rows: PlacesRow[] = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await copyIfExists(`${dbPath}-wal`, `${copy}-wal`);
        await fs.promises.copyFile(dbPath, copy);
      } catch (err) {
        throw translateFsError(err, dbPath);
      }
      try {
        // Read-only, so the snapshot is never written to; the WAL is still replayed into it.
        const db = new DatabaseSync(copy, { readOnly: true });
        try {
          rows = db.prepare(PLACES_QUERY).all() as unknown as PlacesRow[];
        } finally {
          db.close();
        }
        break;
      } catch (err) {
        // A torn snapshot (Firefox checkpointed mid-copy) is rare; retry once.
        if (attempt === 2 || !/malformed|corrupt|not a database/i.test(errorMessage(err)))
          throw err;
        log.warn('places.sqlite snapshot looked inconsistent; retrying once');
        await new Promise((r) => window.setTimeout(r, 500));
      }
    }

    const entries = placesRowsToEntries(rows, wanted);
    log.debug(`Firefox (places.sqlite): parsed ${entries.length} reading-list items`);
    return entries;
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function placesRowsToEntries(rows: PlacesRow[], wanted: string[]): ReadingListEntry[] {
  const byId = new Map<number, PlacesRow>();
  for (const row of rows) byId.set(row.id, row);

  const cache = new Map<number, string[] | null>();
  const pathOfFolder = (folderId: number): string[] | null => {
    if (cache.has(folderId)) return cache.get(folderId) ?? null;
    const parts: string[] = [];
    let current = byId.get(folderId);
    let result: string[] | null = null;
    for (let depth = 0; current && depth < 64; depth++) {
      if (current.guid === ROOT_GUID) {
        result = parts;
        break;
      }
      if (current.guid === TAGS_GUID) break; // tag "folders" duplicate real bookmarks
      const label = ROOT_LABELS[current.guid] ?? (current.title ?? '').trim();
      if (label) parts.unshift(label);
      current = byId.get(current.parent);
    }
    cache.set(folderId, result);
    return result;
  };

  const out: ReadingListEntry[] = [];
  for (const row of rows) {
    if (row.type !== 1 || !isImportableUrl(row.url)) continue;
    const folderPath = pathOfFolder(row.parent);
    if (folderPath === null) continue;
    if (!folderMatches(folderPath, wanted)) continue;
    out.push({
      sourceId: row.guid,
      title: (row.title ?? '').trim(),
      url: row.url.trim(),
      dateAdded: row.dateAdded ? new Date(row.dateAdded / 1000) : null,
      excerpt: '',
      read: null,
      browser: 'firefox',
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* bookmarkbackups/*.jsonlz4 (or plain .json) - no external tools      */
/* ------------------------------------------------------------------ */

interface BackupNode {
  guid?: string;
  title?: string;
  root?: string;
  type?: string;
  uri?: string;
  dateAdded?: number;
  children?: BackupNode[];
}

async function newestBackupIn(dir: string): Promise<string | null> {
  for (const candidate of [dir, path.join(dir, 'bookmarkbackups')]) {
    let names: string[];
    try {
      names = await fs.promises.readdir(candidate);
    } catch {
      continue;
    }
    const files = await Promise.all(
      names
        .filter((n) => /^bookmarks-.*\.jsonlz4$/i.test(n))
        .map(async (n) => {
          const file = path.join(candidate, n);
          return { file, mtime: (await fs.promises.stat(file)).mtimeMs };
        }),
    );
    files.sort((a, b) => b.mtime - a.mtime);
    if (files[0]) return files[0].file;
  }
  return null;
}

async function readBackupFile(
  filePath: string,
  log: Logger,
  wanted: string[],
): Promise<ReadingListEntry[]> {
  const buffer = await readFileOrThrow(filePath);
  let text: string;
  try {
    text = filePath.toLowerCase().endsWith('.jsonlz4')
      ? Buffer.from(decodeMozLz4(buffer)).toString('utf8')
      : buffer.toString('utf8');
  } catch (err) {
    throw new ReadingListSourceError(`Could not decompress ${filePath}: ${errorMessage(err)}`, err);
  }

  let root: BackupNode;
  try {
    root = JSON.parse(text.replace(/^\uFEFF/, '')) as BackupNode;
  } catch (err) {
    throw new ReadingListSourceError(`${filePath} does not contain valid bookmark JSON.`, err);
  }

  const out: ReadingListEntry[] = [];
  for (const top of root.children ?? []) {
    if (top.root === 'tagsFolder' || top.guid === TAGS_GUID) continue;
    const label =
      BACKUP_ROOT_LABELS[top.root ?? ''] ?? ROOT_LABELS[top.guid ?? ''] ?? (top.title ?? '').trim();
    walkBackup(top.children ?? [], label ? [label] : [], out, wanted);
  }
  log.debug(`Firefox (backup ${path.basename(filePath)}): parsed ${out.length} reading-list items`);
  return out;
}

function walkBackup(
  nodes: BackupNode[],
  trail: string[],
  out: ReadingListEntry[],
  wanted: string[],
): void {
  for (const node of nodes) {
    if (node.type === 'text/x-moz-place') {
      if (!isImportableUrl(node.uri)) continue;
      if (!folderMatches(trail, wanted)) continue;
      out.push({
        sourceId: node.guid ?? '',
        title: (node.title ?? '').trim(),
        url: node.uri.trim(),
        dateAdded: node.dateAdded ? new Date(node.dateAdded / 1000) : null,
        excerpt: '',
        read: null,
        browser: 'firefox',
      });
    } else if (node.type === 'text/x-moz-place-container') {
      const name = (node.title ?? '').trim();
      walkBackup(node.children ?? [], name ? [...trail, name] : trail, out, wanted);
    }
  }
}
