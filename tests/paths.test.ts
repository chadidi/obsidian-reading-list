import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  chromiumReadingListFile,
  expandPath,
  defaultBrowserPath,
  detectedProfileBookmarkPath,
  resolveSourcePath,
} from '../src/paths';
import { ReadingListSourceError } from '../src/errors';

test('expandPath expands tilde and environment variables', () => {
  const home = os.homedir();
  assert.equal(expandPath('~'), home);
  assert.equal(
    expandPath('~/Documents/bookmarks.json'),
    path.join(home, 'Documents', 'bookmarks.json'),
  );
  assert.equal(expandPath(''), '');

  process.env.TEST_VAR = 'my_custom_folder';
  assert.equal(
    expandPath('/path/to/$TEST_VAR/file'),
    path.normalize('/path/to/my_custom_folder/file'),
  );
  assert.equal(
    expandPath('/path/to/${TEST_VAR}/file'),
    path.normalize('/path/to/my_custom_folder/file'),
  );
  assert.equal(
    expandPath('/path/to/%TEST_VAR%/file'),
    path.normalize('/path/to/my_custom_folder/file'),
  );
  delete process.env.TEST_VAR;
});

test('defaultBrowserPath returns expected path format by platform', () => {
  const chromePath = defaultBrowserPath('chrome');
  assert.ok(chromePath.length > 0);
  assert.match(chromePath, /Bookmarks/);

  const edgePath = defaultBrowserPath('edge');
  assert.ok(edgePath.length > 0);
  assert.match(edgePath, /Bookmarks/);

  if (process.platform === 'darwin') {
    const safariPath = defaultBrowserPath('safari');
    assert.match(safariPath, /Safari[/\\]Bookmarks\.plist/);
  } else {
    assert.equal(defaultBrowserPath('safari'), '');
  }
});

test('detectedProfileBookmarkPath resolves the chosen browser profile', () => {
  assert.equal(
    detectedProfileBookmarkPath(
      'chrome',
      [
        {
          id: 'Default',
          name: 'Default',
          path: '/profiles/Default',
          bookmarkPaths: ['/profiles/Default/Bookmarks'],
        },
        {
          id: 'Profile 1',
          name: 'Work',
          path: '/profiles/Profile 1',
          bookmarkPaths: ['/profiles/Profile 1/AccountBookmarks'],
        },
      ],
      'Profile 1',
    ),
    '/profiles/Profile 1/AccountBookmarks',
  );
});

test('detectedProfileBookmarkPath derives files for browsers without reported bookmark paths', () => {
  const profile = {
    id: 'Default',
    name: 'Default',
    path: '/profiles/Default',
    bookmarkPaths: [],
  };
  assert.equal(
    detectedProfileBookmarkPath('brave', [profile], ''),
    path.join('/profiles/Default', 'Bookmarks'),
  );
  assert.equal(
    detectedProfileBookmarkPath('firefox', [profile], ''),
    path.join('/profiles/Default', 'places.sqlite'),
  );
  assert.equal(
    detectedProfileBookmarkPath('safari', [profile], ''),
    path.join('/profiles/Default', 'Bookmarks.plist'),
  );
});

test('resolveSourcePath falls back to defaultBrowserPath when empty', () => {
  const resolved = resolveSourcePath('chrome', '');
  assert.equal(resolved, defaultBrowserPath('chrome'));
});

test('resolveSourcePath throws when the selected browser has no detected profile', () => {
  if (process.platform !== 'darwin') {
    assert.throws(
      () => resolveSourcePath('safari', ''),
      (err: unknown) => {
        return (
          err instanceof ReadingListSourceError &&
          /No bookmarks file was found for the selected Safari profile/i.test(err.message)
        );
      },
    );
  }
});

test('chromiumReadingListFile points at the "Reading List" JSON file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-chrome-'));
  try {
    assert.equal(chromiumReadingListFile(dir), path.join(dir, 'Reading List'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
