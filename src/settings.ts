import { isBrowserType, type ReadingListSettings } from './types';

export const DEFAULT_SETTINGS: ReadingListSettings = {
  browser: 'chrome',
  paths: { chrome: '', edge: '', chromium: '', firefox: '', safari: '' },
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
  raw: Partial<ReadingListSettings> | undefined | null,
): ReadingListSettings {
  const interval = raw?.intervalMinutes;
  return {
    browser: isBrowserType(raw?.browser) ? raw.browser : DEFAULT_SETTINGS.browser,
    paths: { ...DEFAULT_SETTINGS.paths, ...(raw?.paths ?? {}) },
    chromeFolder:
      typeof raw?.chromeFolder === 'string' ? raw.chromeFolder : DEFAULT_SETTINGS.chromeFolder,
    edgeFolder:
      typeof raw?.edgeFolder === 'string' ? raw.edgeFolder : DEFAULT_SETTINGS.edgeFolder,
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
