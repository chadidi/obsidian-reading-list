import { isBrowserType, type BrowserType, type ReadingListSettings } from './types';
import { BROWSER_NAMES, isChromiumBrowser, isFirefoxBrowser } from 'browsers-detect';

type StoredReadingListSettings = Partial<ReadingListSettings> & {
  /** Previous versions stored source file paths here. */
  paths?: Record<string, string>;
  chromeFolder?: string;
  edgeFolder?: string;
  chromiumFolder?: string;
  firefoxFolder?: string;
};

export function defaultBookmarksFolder(browser: BrowserType): string {
  if (browser === 'edge') return 'Other Favorites/Reading List';
  if (browser === 'safari') return 'Reading List';
  return 'Other Bookmarks/Reading List';
}

export const DEFAULT_SETTINGS: ReadingListSettings = {
  browser: 'chrome',
  profiles: Object.fromEntries(
    Object.keys(BROWSER_NAMES).map((browser) => [browser, '']),
  ) as Record<ReadingListSettings['browser'], string>,
  bookmarksFolder: defaultBookmarksFolder('chrome'),
  intervalMinutes: 0,
  syncOnStartup: true,
  debug: false,
  initialSyncDone: false,
};

/** Upper bound for the sync interval: one week. */
export const MAX_INTERVAL_MINUTES = 10080;

/**
 * Merges stored settings over the defaults and repairs invalid values. Unknown fields from older
 * plugin versions (target folder, template selection, ...) are dropped, since the plugin now
 * renders a dashboard instead of one note per item.
 */
export function normalizeSettings(
  raw: StoredReadingListSettings | undefined | null,
): ReadingListSettings {
  const interval = raw?.intervalMinutes;
  const browser = isBrowserType(raw?.browser) ? raw.browser : DEFAULT_SETTINGS.browser;
  const legacyFolder =
    browser === 'chrome'
      ? raw?.chromeFolder
      : browser === 'edge'
        ? raw?.edgeFolder
        : isFirefoxBrowser(browser)
          ? raw?.firefoxFolder
          : isChromiumBrowser(browser)
            ? raw?.chromiumFolder
            : undefined;
  const storedFolder =
    typeof raw?.bookmarksFolder === 'string'
      ? raw.bookmarksFolder
      : typeof legacyFolder === 'string'
        ? legacyFolder
        : undefined;
  return {
    browser,
    profiles: { ...DEFAULT_SETTINGS.profiles, ...(raw?.profiles ?? {}) },
    bookmarksFolder:
      storedFolder === 'Reading List'
        ? defaultBookmarksFolder(browser)
        : (storedFolder ?? defaultBookmarksFolder(browser)),
    intervalMinutes:
      typeof interval === 'number' && Number.isFinite(interval) && interval >= 0
        ? Math.min(Math.floor(interval), MAX_INTERVAL_MINUTES)
        : DEFAULT_SETTINGS.intervalMinutes,
    syncOnStartup:
      typeof raw?.syncOnStartup === 'boolean' ? raw.syncOnStartup : DEFAULT_SETTINGS.syncOnStartup,
    debug: typeof raw?.debug === 'boolean' ? raw.debug : DEFAULT_SETTINGS.debug,
    initialSyncDone: raw?.initialSyncDone === true,
  };
}
