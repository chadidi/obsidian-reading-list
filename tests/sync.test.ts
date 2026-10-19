import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine } from '../src/sync';
import { DEFAULT_SETTINGS } from '../src/settings';
import { Logger } from '../src/logger';
import type { ReadingListEntry, ReadingListSettings, StoredEntry, SyncHost } from '../src/types';

const silentLogger = new Logger(() => false);

function createHost(settings: Partial<ReadingListSettings> = {}, entries: StoredEntry[] = []) {
  const state = { entries };
  const host: SyncHost = {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    log: silentLogger,
    get entries() {
      return state.entries;
    },
    setEntries(next) {
      state.entries = next;
    },
  };
  return { host, state };
}

function entry(overrides: Partial<ReadingListEntry> = {}): ReadingListEntry {
  return {
    sourceId: '1',
    title: 'Obsidian',
    url: 'https://obsidian.md',
    dateAdded: new Date('2024-01-01'),
    excerpt: '',
    read: null,
    browser: 'chrome',
    ...overrides,
  };
}

test('replace stores every item and reports them all as added on a first sync', () => {
  const { host, state } = createHost();
  const engine = new SyncEngine(host);

  const result = engine.replace([
    entry({ url: 'https://a.com', title: 'A' }),
    entry({ url: 'https://b.com', title: 'B' }),
  ]);

  assert.equal(result.total, 2);
  assert.equal(result.added, 2);
  assert.equal(result.removed, 0);
  assert.equal(result.unchanged, 0);
  assert.equal(state.entries.length, 2);
  assert.equal(state.entries[0]!.title, 'A');
});

test('replace converts dates to epoch milliseconds for storage', () => {
  const { host, state } = createHost();
  const engine = new SyncEngine(host);

  engine.replace([entry({ dateAdded: new Date('2024-03-15T12:00:00Z') })]);

  assert.equal(state.entries[0]!.dateAdded, new Date('2024-03-15T12:00:00Z').getTime());
});

test('replace records null dateAdded when the browser has no date', () => {
  const { host, state } = createHost();
  const engine = new SyncEngine(host);

  engine.replace([entry({ dateAdded: null })]);

  assert.equal(state.entries[0]!.dateAdded, null);
});

test('replace reports items seen before as unchanged and new ones as added', () => {
  const known: StoredEntry = {
    url: 'https://known.com',
    title: 'Known',
    dateAdded: null,
    excerpt: '',
    read: null,
    browser: 'chrome',
  };
  const { host } = createHost({}, [known]);
  const engine = new SyncEngine(host);

  const result = engine.replace([
    entry({ url: 'https://known.com' }),
    entry({ url: 'https://new.com' }),
  ]);

  assert.equal(result.added, 1);
  assert.equal(result.unchanged, 1);
  assert.equal(result.total, 2);
});

test('replace counts items no longer in the browser as removed', () => {
  const kept: StoredEntry = {
    url: 'https://keep.com',
    title: 'Keep',
    dateAdded: null,
    excerpt: '',
    read: null,
    browser: 'chrome',
  };
  const gone: StoredEntry = {
    url: 'https://gone.com',
    title: 'Gone',
    dateAdded: null,
    excerpt: '',
    read: null,
    browser: 'chrome',
  };
  const { host, state } = createHost({}, [kept, gone]);
  const engine = new SyncEngine(host);

  const result = engine.replace([entry({ url: 'https://keep.com' })]);

  assert.equal(result.removed, 1);
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0]!.url, 'https://keep.com');
});

test('replace de-duplicates URLs, keeping the first occurrence', () => {
  const { host, state } = createHost();
  const engine = new SyncEngine(host);

  const result = engine.replace([
    entry({ url: 'https://dup.com', title: 'First' }),
    entry({ url: 'https://dup.com', title: 'Second' }),
  ]);

  assert.equal(result.total, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(state.entries[0]!.title, 'First');
});

test('replace trims whitespace around URLs and drops blank ones', () => {
  const { host, state } = createHost();
  const engine = new SyncEngine(host);

  const result = engine.replace([entry({ url: '  https://trimmed.com  ' }), entry({ url: '   ' })]);

  assert.equal(result.total, 1);
  assert.equal(state.entries[0]!.url, 'https://trimmed.com');
});
