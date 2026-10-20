import { isBrowserType, type ReadingListSettings } from './types';
import { BROWSER_NAMES } from 'browsers-detect';

type StoredReadingListSettings = Partial<ReadingListSettings> & {
  /** Previous versions stored source file paths here. */
  paths?: Record<string, string>;
};

export const DEFAULT_SETTINGS: ReadingListSettings = {
  browser: 'chrome',
  profiles: Object.fromEntries(
    Object.keys(BROWSER_NAMES).map((browser) => [browser, '']),
  ) as Record<ReadingListSettings['browser'], string>,
  chromeFolder: 'Other Bookmarks/Reading List',
  edgeFolder: 'Other Favorites/Reading List',
  chromiumFolder: 'Other Bookmarks/Reading List',
  firefoxFolder: 'Reading List',
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
  return {
    browser: isBrowserType(raw?.browser) ? raw.browser : DEFAULT_SETTINGS.browser,
    profiles: { ...DEFAULT_SETTINGS.profiles, ...(raw?.profiles ?? {}) },
    chromeFolder:
      typeof raw?.chromeFolder === 'string' ? raw.chromeFolder : DEFAULT_SETTINGS.chromeFolder,
    edgeFolder: typeof raw?.edgeFolder === 'string' ? raw.edgeFolder : DEFAULT_SETTINGS.edgeFolder,
    chromiumFolder:
      typeof raw?.chromiumFolder === 'string'
        ? raw.chromiumFolder
        : DEFAULT_SETTINGS.chromiumFolder,
    firefoxFolder:
      typeof raw?.firefoxFolder === 'string' ? raw.firefoxFolder : DEFAULT_SETTINGS.firefoxFolder,
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
