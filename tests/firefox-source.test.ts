import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { placesRowsToEntries, readFirefoxReadingList } from '../src/sources/firefox';
import { ReadingListSourceError } from '../src/errors';
import { Logger } from '../src/logger';

const silentLogger = new Logger(() => false);

test('placesRowsToEntries keeps only bookmarks inside the configured folder', () => {
  const rows = [
    // Roots
    { id: 1, parent: 0, type: 2, title: null, guid: 'root________', dateAdded: null, url: null },
    { id: 2, parent: 1, type: 2, title: null, guid: 'menu________', dateAdded: null, url: null },
    { id: 3, parent: 1, type: 2, title: null, guid: 'toolbar_____', dateAdded: null, url: null },
    { id: 4, parent: 1, type: 2, title: null, guid: 'tags________', dateAdded: null, url: null },

    // The folder Firefox bookmarks are read from.
    {
      id: 10,
      parent: 3,
      type: 2,
      title: 'Reading List',
      guid: 'guid-f-10',
      dateAdded: null,
      url: null,
    },

    // A bookmark inside the reading-list folder.
    {
      id: 100,
      parent: 10,
      type: 1,
      title: 'Article',
      guid: 'guid-bm-1',
      dateAdded: 1700000000000000, // microseconds
      url: 'https://article.example.com',
    },
    // A bookmark outside the reading-list folder.
    {
      id: 101,
      parent: 2,
      type: 1,
      title: 'Mozilla',
      guid: 'guid-bm-2',
      dateAdded: 1700000000000000,
      url: 'https://www.mozilla.org',
    },
    // Bookmark in tag folder (should be skipped)
    {
      id: 102,
      parent: 4,
      type: 1,
      title: 'Tagged Item',
      guid: 'guid-bm-3',
      dateAdded: null,
      url: 'https://tagged.example.com',
    },
    // Non-bookmark row (separator)
    {
      id: 103,
      parent: 2,
      type: 3,
      title: null,
      guid: 'guid-sep-1',
      dateAdded: null,
      url: null,
    },
    // Non-importable URL (Firefox smart query)
    {
      id: 104,
      parent: 2,
      type: 1,
      title: 'Most Visited',
      guid: 'guid-smart-1',
      dateAdded: null,
      url: 'place:sort=8&maxResults=10',
    },
  ];

  const inFolder = placesRowsToEntries(rows, ['reading list']);
  assert.equal(inFolder.length, 1);
  assert.equal(inFolder[0]?.title, 'Article');
  assert.equal(inFolder[0]?.url, 'https://article.example.com');
  assert.equal(inFolder[0]?.sourceId, 'guid-bm-1');
  assert.ok(inFolder[0]?.dateAdded instanceof Date);
  assert.equal(inFolder[0]?.browser, 'firefox');

  // Matching also works against the mapped root labels, so the built-in folders can be targeted.
  const inMenu = placesRowsToEntries(rows, ['bookmarks menu']);
  assert.equal(inMenu.length, 1);
  assert.equal(inMenu[0]?.title, 'Mozilla');
  assert.equal(inMenu[0]?.url, 'https://www.mozilla.org');
});

test('readFirefoxReadingList reads a JSON backup filtered by folder', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'firefox-test-'));
  const tmpFile = path.join(tmpDir, 'bookmarks-2024.json');

  const backupData = {
    guid: 'root________',
    title: '',
    children: [
      {
        guid: 'menu________',
        root: 'bookmarksMenuFolder',
        children: [
          {
            guid: 'bm-json-1',
            title: 'MDN Web Docs',
            type: 'text/x-moz-place',
            uri: 'https://developer.mozilla.org',
            dateAdded: 1700000000000000,
          },
          {
            guid: 'folder-rl',
            title: 'Reading List',
            type: 'text/x-moz-place-container',
            children: [
              {
                guid: 'bm-json-2',
                title: 'Long Read',
                type: 'text/x-moz-place',
                uri: 'https://longread.example.com',
                dateAdded: 1700000000000000,
              },
            ],
          },
        ],
      },
    ],
  };

  try {
    await fs.writeFile(tmpFile, JSON.stringify(backupData), 'utf8');
    const entries = await readFirefoxReadingList(tmpFile, silentLogger, 'Reading List');

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.title, 'Long Read');
    assert.equal(entries[0]?.url, 'https://longread.example.com');
    assert.equal(entries[0]?.browser, 'firefox');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('readFirefoxReadingList returns nothing when the folder setting is empty', async () => {
  const entries = await readFirefoxReadingList('/does/not/matter', silentLogger, '');
  assert.deepEqual(entries, []);
});

test('readFirefoxReadingList throws on an empty directory without places or backups', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'firefox-test-'));

  try {
    await assert.rejects(
      () => readFirefoxReadingList(tmpDir, silentLogger, 'Reading List'),
      (err: unknown) =>
        err instanceof ReadingListSourceError &&
        /contains neither places\.sqlite nor bookmarks-\*\.jsonlz4 backups/i.test(
          (err as Error).message,
        ),
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('readFirefoxReadingList reads rows that only live in the places.sqlite WAL', async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'firefox-wal-'));
  const db = new DatabaseSync(path.join(profile, 'places.sqlite'));

  try {
    db.exec('PRAGMA journal_mode=WAL;');
    db.exec(
      'CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, parent INTEGER, type INTEGER, ' +
        'title TEXT, guid TEXT, dateAdded INTEGER, fk INTEGER);',
    );
    db.exec('CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT);');
    db.exec(
      'INSERT INTO moz_places (id, url) VALUES ' +
        "(1, 'https://checkpointed.example'), (2, 'https://wal-only.example');",
    );
    db.exec(
      'INSERT INTO moz_bookmarks VALUES ' +
        "(1, 0, 2, NULL, 'root________', NULL, NULL), " +
        "(2, 1, 2, NULL, 'menu________', NULL, NULL), " +
        "(100, 2, 1, 'Checkpointed', 'guid-bm-1', 1700000000000000, 1);",
    );
    // Everything inserted so far is folded into places.sqlite itself...
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    // ...so this bookmark only exists in places.sqlite-wal for as long as the database is open.
    db.exec(
      "INSERT INTO moz_bookmarks VALUES (101, 2, 1, 'In WAL', 'guid-bm-2', 1700000000000000, 2);",
    );

    const entries = await readFirefoxReadingList(profile, silentLogger, 'Bookmarks Menu');

    assert.equal(entries.length, 2);
    const fromWal = entries.find((entry) => entry.title === 'In WAL');
    assert.ok(fromWal);
    assert.equal(fromWal.url, 'https://wal-only.example');
    assert.equal(fromWal.sourceId, 'guid-bm-2');
    assert.ok(fromWal.dateAdded instanceof Date);
  } finally {
    db.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});
