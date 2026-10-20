import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  detectBrowsersSync,
  isChromiumBrowser,
  isFirefoxBrowser,
  type BrowserProfile,
} from 'browsers-detect';
import { ReadingListSourceError, errorMessage } from './errors';
import { BROWSER_LABELS, type BrowserType } from './types';

/** Expands `~`, `%VAR%`, `$VAR` and `${VAR}` in user-supplied paths. */
export function expandPath(input: string): string {
  let p = input.trim();
  if (!p) return '';
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    p = path.join(os.homedir(), p.slice(1));
  }
  p = p.replace(/%([^%]+)%/g, (m, name: string) => process.env[name] ?? m);
  p = p.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, name: string) => process.env[name] ?? m);
  return path.normalize(p);
}

function firefoxProfileRoots(): string[] {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return [path.join(home, 'Library', 'Application Support', 'Firefox', 'Profiles')];
    case 'win32':
      return [
        path.join(
          process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
          'Mozilla',
          'Firefox',
          'Profiles',
        ),
      ];
    default:
      return [
        path.join(home, '.mozilla', 'firefox'),
        path.join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox'),
        path.join(home, '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox'),
      ];
  }
}

/** Finds places.sqlite of the most plausible Firefox profile (prefers *.default-release). */
export function detectFirefoxPlacesPath(): string | null {
  const found: { file: string; score: number; mtime: number }[] = [];
  for (const root of firefoxProfileRoots()) {
    let dirs: fs.Dirent[];
    try {
      dirs = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const file = path.join(root, dir.name, 'places.sqlite');
      try {
        const stat = fs.statSync(file);
        found.push({
          file,
          score: dir.name.endsWith('.default-release') ? 1 : 0,
          mtime: stat.mtimeMs,
        });
      } catch {
        /* profile without bookmarks database */
      }
    }
  }
  found.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  return found[0]?.file ?? null;
}

/** The user data directory of a Chromium-based browser (Chrome, Edge, or Chromium) for the current platform. */
function chromiumUserDataDir(kind: 'chrome' | 'edge' | 'chromium'): string {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
  switch (process.platform) {
    case 'darwin':
      if (kind === 'chrome')
        return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
      if (kind === 'edge')
        return path.join(home, 'Library', 'Application Support', 'Microsoft Edge');
      return path.join(home, 'Library', 'Application Support', 'Chromium');
    case 'win32':
      if (kind === 'chrome') return path.join(local, 'Google', 'Chrome', 'User Data');
      if (kind === 'edge') return path.join(local, 'Microsoft', 'Edge', 'User Data');
      return path.join(local, 'Chromium', 'User Data');
    default:
      if (kind === 'chrome') return path.join(home, '.config', 'google-chrome');
      if (kind === 'edge') return path.join(home, '.config', 'microsoft-edge');
      return path.join(home, '.config', 'chromium');
  }
}

/**
 * The bookmarks file inside a Chromium profile directory. Modern Chrome/Chromium stores
 * bookmarks in "Bookmarks", or in "AccountBookmarks" if account sync is active.
 */
export function chromiumBookmarksFile(profileDir: string): string {
  const account = path.join(profileDir, 'AccountBookmarks');
  if (fs.existsSync(account)) return account;
  const bookmarks = path.join(profileDir, 'Bookmarks');
  if (fs.existsSync(bookmarks)) return bookmarks;
  return bookmarks;
}

/** Finds Bookmarks or AccountBookmarks of the most plausible Chromium profile. */
export function detectChromiumBookmarksPath(kind: 'chrome' | 'edge' | 'chromium'): string {
  const base = chromiumUserDataDir(kind);
  const profiles = ['Default', 'Profile 1', 'Profile 2', 'Profile 3', 'Profile 4', 'Profile 5'];
  for (const prof of profiles) {
    const profDir = path.join(base, prof);
    const account = path.join(profDir, 'AccountBookmarks');
    if (fs.existsSync(account)) return account;
    const bookmarks = path.join(profDir, 'Bookmarks');
    if (fs.existsSync(bookmarks)) return bookmarks;
  }
  return path.join(base, 'Default', 'Bookmarks');
}

/**
 * The reading-list file inside a Chromium profile directory. Chrome, Chromium and other
 * Chromium-based browsers store the reading list as a JSON file named "Reading List" (no
 * extension) in the profile directory.
 */
export function chromiumReadingListFile(profileDir: string): string {
  return path.join(profileDir, 'Reading List');
}

/** Platform default for a browser's reading list, or "" when there is none. */
export function defaultBrowserPath(browser: BrowserType): string {
  const home = os.homedir();
  switch (browser) {
    case 'chrome':
      return detectChromiumBookmarksPath('chrome');
    case 'edge':
      return detectChromiumBookmarksPath('edge');
    case 'chromium':
      return detectChromiumBookmarksPath('chromium');
    case 'safari':
      return process.platform === 'darwin'
        ? path.join(home, 'Library', 'Safari', 'Bookmarks.plist')
        : '';
    case 'firefox':
      return detectFirefoxPlacesPath() ?? '';
    default:
      return '';
  }
}

function profileBookmarkPath(browser: BrowserType, profilePath: string): string | null {
  if (isChromiumBrowser(browser)) return chromiumBookmarksFile(profilePath);
  if (isFirefoxBrowser(browser)) return path.join(profilePath, 'places.sqlite');
  if (browser === 'safari') return path.join(profilePath, 'Bookmarks.plist');
  return null;
}

/** Resolves the selected profile, preferring a usable default when no ID is stored. */
export function detectedProfileBookmarkPath(
  browser: BrowserType,
  profiles: BrowserProfile[],
  profileId: string,
): string | null {
  const profile =
    profiles.find((candidate) => candidate.id === profileId) ??
    profiles.find((candidate) => candidate.isDefault && candidate.bookmarkPaths.length > 0) ??
    profiles.find((candidate) => candidate.isDefault) ??
    profiles[0];
  return profile?.bookmarkPaths[0] ?? (profile ? profileBookmarkPath(browser, profile.path) : null);
}

/** Resolves a selected detected profile to its bookmark file. */
export function resolveSourcePath(browser: BrowserType, profileId: string): string {
  const detected = detectBrowsersSync().find((candidate) => candidate.id === browser);
  const bookmarkPath =
    detectedProfileBookmarkPath(browser, detected?.profiles ?? [], profileId) ??
    (profileId ? null : defaultBrowserPath(browser));
  if (bookmarkPath) return bookmarkPath;
  throw new ReadingListSourceError(
    `No bookmarks file was found for the selected ${BROWSER_LABELS[browser]} profile.`,
  );
}

export interface SourceAccess {
  /** The resolved path, or null when none could be determined for this platform. */
  resolved: string | null;
  /** Whether the path exists on disk. */
  exists: boolean;
  /** Whether the path can actually be read (false when access has not been granted). */
  accessible: boolean;
  /** User-friendly reason when `resolved` is null. */
  error?: string;
}

/** Reads one entry to confirm the OS really lets us in (covers macOS TCC / Full Disk Access). */
function canRead(resolved: string): boolean {
  try {
    if (fs.statSync(resolved).isDirectory()) {
      fs.readdirSync(resolved);
    } else {
      fs.closeSync(fs.openSync(resolved, 'r'));
    }
    return true;
  } catch {
    return false;
  }
}

/** Reports whether the configured browser bookmark source is reachable and readable. */
export function checkSourceAccess(browser: BrowserType, profileId: string): SourceAccess {
  let resolved: string;
  try {
    resolved = resolveSourcePath(browser, profileId);
  } catch (err) {
    return { resolved: null, exists: false, accessible: false, error: errorMessage(err) };
  }
  const exists = fs.existsSync(resolved);
  return { resolved, exists, accessible: exists && canRead(resolved) };
}
