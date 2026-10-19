import type { Logger } from './logger';

export type BrowserType = 'chrome' | 'chromium' | 'firefox' | 'safari';

export const BROWSER_LABELS: Record<BrowserType, string> = {
  chrome: 'Google Chrome',
  chromium: 'Chromium',
  firefox: 'Mozilla Firefox',
  safari: 'Safari',
};

const BROWSERS: BrowserType[] = ['chrome', 'chromium', 'firefox', 'safari'];

/** True when the value is one of the browsers the plugin knows how to read. */
export function isBrowserType(value: unknown): value is BrowserType {
  return typeof value === 'string' && (BROWSERS as string[]).includes(value);
}

/** A reading-list item normalised across all supported browsers. */
export interface ReadingListEntry {
  /** Browser-internal identifier (informational only; may be empty). */
  sourceId: string;
  title: string;
  url: string;
  /** When the item was added to the reading list, or null when the browser does not record it. */
  dateAdded: Date | null;
  /** Article preview text when the browser records one (Safari), otherwise "". */
  excerpt: string;
  /** Read state when the browser tracks it (Chrome), otherwise null. */
  read: boolean | null;
  browser: BrowserType;
}

/**
 * A reading-list item as persisted in the plugin data, so the dashboard can render the list
 * without re-reading the browser on every open. Dates are stored as epoch milliseconds to
 * survive a JSON round-trip.
 */
export interface StoredEntry {
  url: string;
  title: string;
  /** Epoch milliseconds when the item was added, or null when the browser does not record it. */
  dateAdded: number | null;
  excerpt: string;
  /** Read state when the browser tracks one (Chrome), otherwise null (unknown). */
  read: boolean | null;
  browser: BrowserType;
}

export type SyncTrigger = 'manual' | 'periodic' | 'startup';

/** How the freshly read list differs from the previously stored one. */
export interface SyncResult {
  total: number;
  /** URLs that appear for the first time. */
  added: number;
  /** URLs that are no longer in the browser's reading list. */
  removed: number;
  /** URLs that were already known from an earlier sync. */
  unchanged: number;
  /** Same URL seen more than once in the browser (first occurrence wins). */
  duplicates: number;
  durationMs: number;
}

/**
 * A Safari Bookmarks.plist (which also holds the Safari Reading List) the user selected through the
 * native file dialog. macOS grants read access to just that file for the current session, so the
 * bytes live in memory only.
 */
export interface SafariPick {
  buffer: Buffer;
  /** Absolute path reported by the picker, or "" when the platform does not expose one. */
  path: string;
  /** Base file name, used for display in the settings UI. */
  fileName: string;
}

export interface ReadingListSettings {
  browser: BrowserType;
  /** Per-browser source path. Empty string = use the auto-detected default. */
  paths: Record<BrowserType, string>;
  /**
   * Firefox has no native reading list, so its source reads bookmarks from a bookmark folder
   * (matched by name, anywhere in the tree). Empty disables the Firefox source.
   */
  firefoxFolder: string;
  /** 0 disables periodic sync. */
  intervalMinutes: number;
  syncOnStartup: boolean;
  debug: boolean;
  /** Automatic syncs stay disabled until one manual sync has succeeded. */
  initialSyncDone: boolean;
}

export interface PluginData {
  settings: ReadingListSettings;
  /** Reading-list items from the last successful sync, rendered by the dashboard. */
  entries: StoredEntry[];
  /** Epoch milliseconds of the last successful sync, or 0 when the plugin has never synced. */
  lastSyncAt: number;
}

/** What the sync engine needs from the plugin instance. */
export interface SyncHost {
  settings: ReadingListSettings;
  log: Logger;
  /** Items from the last successful sync. */
  entries: StoredEntry[];
  /** Replaces the stored items after a successful read. */
  setEntries(entries: StoredEntry[]): void;
  /**
   * Session-only bytes of a Safari Bookmarks.plist the user picked via the native file dialog.
   * Null when nothing has been picked this session (macOS clears the grant when Obsidian quits).
   */
  getSafariPickedBuffer?(): Buffer | null;
}
