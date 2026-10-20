import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSettings,
  DEFAULT_SETTINGS,
  MAX_INTERVAL_MINUTES,
  defaultBookmarksFolder,
} from '../src/settings';

test('normalizeSettings returns defaults when given undefined or empty object', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.bookmarksFolder, 'Other Bookmarks/Reading List');
});

test('defaultBookmarksFolder returns the browser-specific folder', () => {
  assert.equal(defaultBookmarksFolder('chrome'), 'Other Bookmarks/Reading List');
  assert.equal(defaultBookmarksFolder('chromium'), 'Other Bookmarks/Reading List');
  assert.equal(defaultBookmarksFolder('brave'), 'Other Bookmarks/Reading List');
  assert.equal(defaultBookmarksFolder('firefox'), 'Other Bookmarks/Reading List');
  assert.equal(defaultBookmarksFolder('firefox-developer-edition'), 'Other Bookmarks/Reading List');
  assert.equal(defaultBookmarksFolder('edge'), 'Other Favorites/Reading List');
  assert.equal(defaultBookmarksFolder('safari'), 'Reading List');
});

test('normalizeSettings clamps intervalMinutes to [0, max]', () => {
  assert.equal(normalizeSettings({ intervalMinutes: -10 }).intervalMinutes, 0);
  assert.equal(
    normalizeSettings({ intervalMinutes: 999999 }).intervalMinutes,
    MAX_INTERVAL_MINUTES,
  );
  assert.equal(normalizeSettings({ intervalMinutes: 30.7 }).intervalMinutes, 30);
});

test('normalizeSettings validates browser', () => {
  assert.equal(normalizeSettings({ browser: 'internet-explorer' as never }).browser, 'chrome');
  assert.equal(normalizeSettings({ browser: 'firefox' }).browser, 'firefox');
  assert.equal(normalizeSettings({ browser: 'edge' }).browser, 'edge');
  assert.equal(normalizeSettings({ browser: 'brave' }).browser, 'brave');
});

test('normalizeSettings stores selected profiles and ignores legacy file paths', () => {
  assert.equal(
    normalizeSettings({ profiles: { chrome: 'Profile 1' } }).profiles.chrome,
    'Profile 1',
  );
  assert.equal(
    normalizeSettings({ paths: { chrome: '/old/custom/Bookmarks' } }).profiles.chrome,
    '',
  );
});

test('normalizeSettings uses one folder setting and migrates the selected browser value', () => {
  assert.equal(normalizeSettings({}).bookmarksFolder, DEFAULT_SETTINGS.bookmarksFolder);
  assert.equal(
    normalizeSettings({ bookmarksFolder: 'Bookmarks Bar/Read Later' }).bookmarksFolder,
    'Bookmarks Bar/Read Later',
  );
  assert.equal(
    normalizeSettings({ browser: 'edge', edgeFolder: 'Favorites Bar/Reading List' })
      .bookmarksFolder,
    'Favorites Bar/Reading List',
  );
  assert.equal(
    normalizeSettings({ browser: 'brave', chromiumFolder: 'Saved' }).bookmarksFolder,
    'Saved',
  );
  assert.equal(
    normalizeSettings({ browser: 'firefox', firefoxFolder: 'Read Later' }).bookmarksFolder,
    'Read Later',
  );
  assert.equal(
    normalizeSettings({ bookmarksFolder: 123 as unknown as string }).bookmarksFolder,
    DEFAULT_SETTINGS.bookmarksFolder,
  );
  assert.equal(
    normalizeSettings({ browser: 'edge', bookmarksFolder: 'Reading List' }).bookmarksFolder,
    'Other Favorites/Reading List',
  );
  assert.equal(
    normalizeSettings({ browser: 'firefox', firefoxFolder: 'Reading List' }).bookmarksFolder,
    'Other Bookmarks/Reading List',
  );
});

test('normalizeSettings keeps booleans and coerces stray values', () => {
  assert.equal(normalizeSettings({}).syncOnStartup, true);
  assert.equal(normalizeSettings({ syncOnStartup: false }).syncOnStartup, false);
  assert.equal(
    normalizeSettings({ syncOnStartup: 'no' as unknown as boolean }).syncOnStartup,
    true,
  );

  assert.equal(normalizeSettings({}).debug, false);
  assert.equal(normalizeSettings({ debug: true }).debug, true);
  assert.equal(normalizeSettings({ initialSyncDone: undefined }).initialSyncDone, false);
  assert.equal(normalizeSettings({ initialSyncDone: true }).initialSyncDone, true);
});

test('normalizeSettings drops fields from older note-writing versions', () => {
  const legacy = normalizeSettings({
    targetFolder: 'ReadLater',
    allowVaultRootTarget: true,
    templateName: 'full',
    customTemplate: '# {{title}}',
  } as never);
  assert.deepEqual(legacy, DEFAULT_SETTINGS);
});
