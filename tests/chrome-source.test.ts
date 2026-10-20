import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readChromeReadingList, chromeTimestampToDate } from '../src/sources/chrome';
import { ReadingListSourceError } from '../src/errors';
import { Logger } from '../src/logger';

const silentLogger = new Logger(() => false);

// Legacy exported format: JSON with a top-level "reading_list" array.
const mockLegacyChromeJson = {
  reading_list: [
    {
      url: 'https://obsidian.md',
      title: 'Obsidian',
      creation_time_us: '13350000000000000', // microseconds since the Unix epoch
      has_been_read: true,
    },
    {
      url: 'https://developer.mozilla.org',
      title: 'MDN',
    },
    {
      url: 'javascript:void(0)', // Should be ignored
      title: 'Bookmarklet',
    },
  ],
};

// Modern native Chrome Bookmarks / AccountBookmarks format.
const mockChromeBookmarksJson = {
  checksum: 'mock123',
  version: 1,
  roots: {
    bookmark_bar: {
      name: 'Bookmarks Bar',
      type: 'folder',
      children: [
        {
          id: '1',
          name: 'Bar Link',
          type: 'url',
          url: 'https://bar.example.com',
          date_added: '13436649197028922',
        },
      ],
    },
    other: {
      name: 'Other Bookmarks',
      type: 'folder',
      children: [
        {
          id: '2',
          name: 'Reading List',
          type: 'folder',
          children: [
            {
              id: '3',
              name: 'Sample Article',
              type: 'url',
              url: 'https://article.example.com',
              date_added: '13436649197028922',
            },
            {
              id: '4',
              name: 'Subfolder',
              type: 'folder',
              children: [
                {
                  id: '5',
                  name: 'Nested Article',
                  type: 'url',
                  url: 'https://nested.example.com',
                  date_added: '13436649197028922',
                },
              ],
            },
          ],
        },
        {
          id: '6',
          name: 'Ignored Other Bookmark',
          type: 'url',
          url: 'https://ignored.example.com',
        },
      ],
    },
  },
};

test('readChromeReadingList parses the reading_list array (legacy/exported format)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-test-'));
  const tmpFile = path.join(tmpDir, 'Reading List');

  try {
    await fs.writeFile(tmpFile, JSON.stringify(mockLegacyChromeJson), 'utf8');
    const entries = await readChromeReadingList(tmpFile, silentLogger);

    assert.equal(entries.length, 2);

    assert.equal(entries[0]?.title, 'Obsidian');
    assert.equal(entries[0]?.url, 'https://obsidian.md');
    assert.ok(entries[0]?.dateAdded instanceof Date);
    assert.equal(entries[0]?.read, true);
    assert.equal(entries[0]?.excerpt, '');
    assert.equal(entries[0]?.browser, 'chrome');

    // No creation time and no read flag: both fall back to "unknown".
    assert.equal(entries[1]?.title, 'MDN');
    assert.equal(entries[1]?.dateAdded, null);
    assert.equal(entries[1]?.read, null);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('readChromeReadingList parses Chrome Bookmarks with default "Other Bookmarks/Reading List"', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-test-'));
  const tmpFile = path.join(tmpDir, 'Bookmarks');

  try {
    await fs.writeFile(tmpFile, JSON.stringify(mockChromeBookmarksJson), 'utf8');
    const entries = await readChromeReadingList(
      tmpFile,
      silentLogger,
      'Other Bookmarks/Reading List',
      'chrome',
    );

    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.title, 'Sample Article');
    assert.equal(entries[0]?.url, 'https://article.example.com');
    assert.ok(entries[0]?.dateAdded instanceof Date);
    assert.equal(entries[1]?.title, 'Nested Article');
    assert.equal(entries[1]?.url, 'https://nested.example.com');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('readChromeReadingList matches folder name case-insensitively or by single segment', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-test-'));
  const tmpFile = path.join(tmpDir, 'Bookmarks');

  try {
    await fs.writeFile(tmpFile, JSON.stringify(mockChromeBookmarksJson), 'utf8');
    const entries = await readChromeReadingList(tmpFile, silentLogger, 'reading list', 'chrome');

    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.title, 'Sample Article');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('readChromeReadingList parses Edge Bookmarks with "Other Favorites/Reading List"', async () => {
  const edgeJson = {
    roots: {
      bookmark_bar: { name: 'Favorites Bar', type: 'folder', children: [] },
      other: {
        name: 'Other Favorites',
        type: 'folder',
        children: [
          {
            name: 'Reading List',
            type: 'folder',
            children: [
              {
                id: '10',
                name: 'Edge Article',
                type: 'url',
                url: 'https://learn.microsoft.com',
                date_added: '13436649197028922',
              },
            ],
          },
        ],
      },
    },
  };

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'edge-test-'));
  const tmpFile = path.join(tmpDir, 'Bookmarks');

  try {
    await fs.writeFile(tmpFile, JSON.stringify(edgeJson), 'utf8');
    const entries = await readChromeReadingList(
      tmpFile,
      silentLogger,
      'Other Favorites/Reading List',
      'edge',
    );

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.title, 'Edge Article');
    assert.equal(entries[0]?.url, 'https://learn.microsoft.com');
    assert.equal(entries[0]?.browser, 'edge');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('chromeTimestampToDate handles WebKit/Windows epoch and Unix epoch', () => {
  // Chrome WebKit epoch (since 1601-01-01)
  const d1 = chromeTimestampToDate('13436649197028922');
  assert.ok(d1 instanceof Date);
  assert.equal(d1.getUTCFullYear(), 2026);

  // Unix epoch microseconds
  const d2 = chromeTimestampToDate('1628294301717305');
  assert.ok(d2 instanceof Date);
  assert.equal(d2.getUTCFullYear(), 2021);

  assert.equal(chromeTimestampToDate(undefined), null);
  assert.equal(chromeTimestampToDate(''), null);
  assert.equal(chromeTimestampToDate('invalid'), null);
});

test('readChromeReadingList throws ReadingListSourceError on malformed file', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-test-'));
  const tmpFile = path.join(tmpDir, 'CorruptReadingList');

  try {
    await fs.writeFile(tmpFile, '{ not valid json', 'utf8');
    await assert.rejects(
      () => readChromeReadingList(tmpFile, silentLogger),
      (err: unknown) =>
        err instanceof ReadingListSourceError && /is not valid JSON/i.test((err as Error).message),
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('readChromeReadingList throws ReadingListSourceError when roots and reading_list are missing', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-test-'));
  const tmpFile = path.join(tmpDir, 'NoReadingList');

  try {
    await fs.writeFile(tmpFile, JSON.stringify({ version: 1 }), 'utf8');
    await assert.rejects(
      () => readChromeReadingList(tmpFile, silentLogger),
      (err: unknown) =>
        err instanceof ReadingListSourceError &&
        /does not contain Chrome bookmarks/i.test((err as Error).message),
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
