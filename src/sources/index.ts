import type { Logger } from '../logger';
import { resolveSourcePath } from '../paths';
import { BROWSER_LABELS, type ReadingListEntry, type ReadingListSettings } from '../types';
import { readChromeReadingList } from './chrome';
import { readFirefoxReadingList } from './firefox';
import { parseSafariReadingList, readSafariReadingList } from './safari';

export interface SourceReadResult {
  entries: ReadingListEntry[];
  sourcePath: string;
}

export interface ReadReadingListOptions {
  /**
   * Session-only bytes of a Safari Bookmarks.plist the user picked via the native file dialog.
   * macOS grants read access to just that file for this session, so it is preferred over the path.
   */
  safariOverride?: Buffer | null;
}

export async function readReadingList(
  settings: ReadingListSettings,
  log: Logger,
  options: ReadReadingListOptions = {},
): Promise<SourceReadResult> {
  const browser = settings.browser;
  const sourcePath = resolveSourcePath(browser, settings.paths[browser]);
  log.info(`Reading ${BROWSER_LABELS[browser]} reading list from ${sourcePath}`);

  switch (browser) {
    case 'chrome':
    case 'chromium':
      return { entries: await readChromeReadingList(sourcePath, log, browser), sourcePath };
    case 'firefox':
      return {
        entries: await readFirefoxReadingList(sourcePath, log, settings.firefoxFolder),
        sourcePath,
      };
    case 'safari': {
      const override = options.safariOverride;
      if (override) {
        return { entries: parseSafariReadingList(override, log), sourcePath };
      }
      return { entries: await readSafariReadingList(sourcePath, log), sourcePath };
    }
  }
}
