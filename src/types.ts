import type { Logger } from './logger';

export type BrowserType = 'chrome' | 'chromium' | 'firefox' | 'safari';

export const BROWSER_LABELS: Record<BrowserType, string> = {
  chrome: 'Google Chrome',
  chromium: 'Chromium',
  firefox: 'Mozilla Firefox',
  safari: 'Safari',
};

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

export type SyncTrigger = 'manual' | 'periodic' | 'startup';

export interface SyncResult {
  total: number;
  created: number;
  updated: number;
  moved: number;
  /** Notes deleted because their reading-list item no longer exists in the browser. */
  removed: number;
  unchanged: number;
  /** Reserved for future use (always 0 since sync always overwrites existing notes). */
  skipped: number;
  /** Same URL seen more than once in the browser (first occurrence wins). */
  duplicates: number;
  failed: number;
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
  targetFolder: string;
  /**
   * Explicit acknowledgement that lets sync run when targetFolder is empty or "/" (the vault root).
   * Off by default; sync is blocked while it is false and the target is the vault root.
   */
  allowVaultRootTarget: boolean;
  /**
   * Firefox has no native reading list, so its source reads bookmarks from a bookmark folder
   * (matched by name, anywhere in the tree). Empty disables the Firefox source.
   */
  firefoxFolder: string;
  /** 0 disables periodic sync. */
  intervalMinutes: number;
  syncOnStartup: boolean;

  /** moment.js format used by {{date}} and {{synced}} when no explicit format is given. */
  dateFormat?: string;
  /**
   * Template to render notes with: the name of a .md file in the templates folder (its file name
   * without the extension), or CUSTOM_TEMPLATE_ID to use the free-form customTemplate below.
   */
  templateName: string;
  /** Template body used when templateName is CUSTOM_TEMPLATE_ID. */
  customTemplate: string;
  debug: boolean;
  /** Automatic syncs stay disabled until one manual sync has succeeded. */
  initialSyncDone: boolean;
}

/** Reading-list item URL -> vault path of the note that represents it. */
export type ReadingListIndex = Record<string, string>;

export interface PluginData {
  settings: ReadingListSettings;
  index: ReadingListIndex;
}

/** What the sync engine needs from the plugin instance. */
export interface SyncHost {
  settings: ReadingListSettings;
  index: ReadingListIndex;
  log: Logger;
  requestIndexSave(): void;
  /**
   * Session-only bytes of a Safari Bookmarks.plist the user picked via the native file dialog.
   * Null when nothing has been picked this session (macOS clears the grant when Obsidian quits).
   */
  getSafariPickedBuffer?(): Buffer | null;
}
