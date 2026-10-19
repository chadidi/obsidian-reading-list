import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readChromeReadingList } from '../src/sources/chrome';
import { ReadingListSourceError } from '../src/errors';
import { Logger } from '../src/logger';

const silentLogger = new Logger(() => false);

// Chrome/Chromium store the reading list as JSON with a top-level "reading_list" array.
const mockChromeJson = {
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

test('readChromeReadingList parses the reading_list array', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-test-'));
  const tmpFile = path.join(tmpDir, 'Reading List');

  try {
    await fs.writeFile(tmpFile, JSON.stringify(mockChromeJson), 'utf8');
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

test('readChromeReadingList throws ReadingListSourceError when reading_list is missing', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-test-'));
  const tmpFile = path.join(tmpDir, 'NoReadingList');

  try {
    await fs.writeFile(tmpFile, JSON.stringify({ version: 1 }), 'utf8');
    await assert.rejects(
      () => readChromeReadingList(tmpFile, silentLogger),
      (err: unknown) =>
        err instanceof ReadingListSourceError &&
        /has no "reading_list" array/i.test((err as Error).message),
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
