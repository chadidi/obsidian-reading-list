import test from 'node:test';
import assert from 'node:assert/strict';
import { TFile, TFolder } from 'obsidian';
import { SyncEngine } from '../src/sync';
import { DEFAULT_SETTINGS } from '../src/settings';
import { Logger } from '../src/logger';
import type {
  ReadingListEntry,
  ReadingListIndex,
  ReadingListSettings,
  SyncHost,
} from '../src/types';

const silentLogger = new Logger(() => false);

function createMockVault() {
  const files = new Map<string, string>();
  const folders = new Set<string>();

  return {
    files,
    folders,
    adapter: {
      async exists(path: string): Promise<boolean> {
        return files.has(path) || folders.has(path);
      },
    },
    getAbstractFileByPath(path: string) {
      if (files.has(path)) {
        const file = new TFile();
        file.path = path;
        file.name = path.split('/').pop() ?? '';
        const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        if (parentPath) {
          const parent = new TFolder();
          parent.path = parentPath;
          parent.name = parentPath.split('/').pop() ?? '';
          file.parent = parent;
        }
        return file;
      }
      if (folders.has(path)) {
        const folder = new TFolder();
        folder.path = path;
        folder.name = path.split('/').pop() ?? '';
        const children: any[] = [];
        for (const f of files.keys()) {
          const p = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
          if (p === path) {
            const cf = new TFile();
            cf.path = f;
            cf.name = f.split('/').pop() ?? '';
            children.push(cf);
          }
        }
        for (const fd of folders) {
          const p = fd.includes('/') ? fd.slice(0, fd.lastIndexOf('/')) : '';
          if (p === path && fd !== path) {
            const cfd = new TFolder();
            cfd.path = fd;
            cfd.name = fd.split('/').pop() ?? '';
            children.push(cfd);
          }
        }
        folder.children = children;
        return folder;
      }
      return null;
    },
    async create(path: string, data: string) {
      if (files.has(path)) throw new Error(`File already exists: ${path}`);
      files.set(path, data);
      const file = new TFile();
      file.path = path;
      file.name = path.split('/').pop() ?? '';
      return file;
    },
    async createFolder(path: string) {
      folders.add(path);
      const folder = new TFolder();
      folder.path = path;
      folder.name = path.split('/').pop() ?? '';
      return folder;
    },
    async cachedRead(file: TFile) {
      return files.get(file.path) ?? '';
    },
    async process(file: TFile, fn: (data: string) => string) {
      const current = files.get(file.path) ?? '';
      const updated = fn(current);
      files.set(file.path, updated);
      return updated;
    },
    async rename(file: TFile, newPath: string) {
      const data = files.get(file.path);
      if (data !== undefined) {
        files.delete(file.path);
        files.set(newPath, data);
      }
      file.path = newPath;
      file.name = newPath.split('/').pop() ?? '';
      const parentPath = newPath.includes('/') ? newPath.slice(0, newPath.lastIndexOf('/')) : '';
      if (parentPath) {
        const parent = new TFolder();
        parent.path = parentPath;
        parent.name = parentPath.split('/').pop() ?? '';
        file.parent = parent;
      } else {
        file.parent = null;
      }
    },
    async delete(abstractFile: any) {
      files.delete(abstractFile.path);
      folders.delete(abstractFile.path);
    },
    async trash(abstractFile: any, _system: boolean) {
      files.delete(abstractFile.path);
      folders.delete(abstractFile.path);
    },
  };
}

function createSyncHost(settings: Partial<ReadingListSettings> = {}) {
  const vault = createMockVault();
  const fileManager = {
    async renameFile(file: TFile, newPath: string) {
      await vault.rename(file, newPath);
    },
    async trashFile(folder: any) {
      await vault.delete(folder);
    },
  };
  const app = { vault, fileManager };
  const index: ReadingListIndex = {};
  const mergedSettings: ReadingListSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
  };

  const host: SyncHost = {
    settings: mergedSettings,
    index,
    log: silentLogger,
    requestIndexSave: () => {},
  };

  return { host, vault, app };
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

test('SyncEngine creates notes and updates index for new reading-list items', async () => {
  const { host, vault, app } = createSyncHost({ targetFolder: 'Reading List' });

  const engine = new SyncEngine(app as any, host, (date) => date.toISOString().slice(0, 10));

  const result = await (engine as any).apply([entry()]);

  assert.equal(result.created, 1);
  assert.equal(result.total, 1);
  assert.equal(result.failed, 0);

  const expectedPath = 'Reading List/Obsidian.md';
  assert.ok(vault.files.has(expectedPath));
  assert.equal(host.index['https://obsidian.md'], expectedPath);
  assert.match(vault.files.get(expectedPath)!, /https:\/\/obsidian\.md/);
});

test('SyncEngine overwrites existing notes on subsequent sync (1-way sync)', async () => {
  const { host, vault, app } = createSyncHost({ targetFolder: 'Reading List' });

  const engine = new SyncEngine(app as any, host, (date) => date.toISOString().slice(0, 10));

  const item = entry({ sourceId: '3', title: 'Vite', url: 'https://vitejs.dev' });

  // First sync: creates
  const res1 = await (engine as any).apply([item]);
  assert.equal(res1.created, 1);

  // Modify file directly in vault to simulate divergence
  vault.files.set('Reading List/Vite.md', 'custom content');

  // Second sync: always overwrites existing notes with the latest template (1-way sync)
  const res2 = await (engine as any).apply([item]);
  assert.equal(res2.updated, 1);
  assert.equal(res2.created, 0);
  assert.notEqual(vault.files.get('Reading List/Vite.md'), 'custom content');

  // Third sync with same content: unchanged
  const res3 = await (engine as any).apply([item]);
  assert.equal(res3.unchanged, 1);
});

test('SyncEngine handleRename updates index for files and folders', () => {
  const { host, app } = createSyncHost();
  const engine = new SyncEngine(app as any, host, () => '');

  host.index['https://a.com'] = 'Reading List/Dev/Tool.md';
  host.index['https://b.com'] = 'Reading List/Design/Figma.md';

  // Rename single file
  engine.handleRename('Reading List/Dev/Tool.md', 'Reading List/Dev/SuperTool.md', false);
  assert.equal(host.index['https://a.com'], 'Reading List/Dev/SuperTool.md');

  // Rename folder
  engine.handleRename('Reading List/Design', 'Reading List/UX', true);
  assert.equal(host.index['https://b.com'], 'Reading List/UX/Figma.md');
});

test('SyncEngine disambiguates two items with the same title', async () => {
  const { host, vault, app } = createSyncHost({ targetFolder: 'Reading List' });

  const engine = new SyncEngine(app as any, host, (date) => date.toISOString().slice(0, 10));

  const entryA = entry({ sourceId: '4', title: 'Tool', url: 'https://tool-a.com' });
  const entryB = entry({ sourceId: '5', title: 'Tool', url: 'https://tool-b.com' });

  const res = await (engine as any).apply([entryA, entryB]);
  assert.equal(res.created, 2);

  // One gets Tool.md, the other gets disambiguated with a hash suffix.
  const files = Array.from(vault.files.keys());
  assert.ok(files.some((f) => f === 'Reading List/Tool.md'));
  assert.ok(files.some((f) => f.startsWith('Reading List/Tool (') && f.endsWith(').md')));
});

test('SyncEngine deletes notes for items removed from the browser', async () => {
  const { host, vault, app } = createSyncHost({ targetFolder: 'Reading List' });

  const engine = new SyncEngine(app as any, host, (date) => date.toISOString().slice(0, 10));

  const kept = entry({ sourceId: '1', title: 'Keep', url: 'https://keep.example.com' });
  const gone = entry({ sourceId: '2', title: 'Gone', url: 'https://gone.example.com' });

  const res1 = await (engine as any).apply([kept, gone]);
  assert.equal(res1.created, 2);
  assert.ok(vault.files.has('Reading List/Gone.md'));

  // Browser no longer returns `gone`.
  const res2 = await (engine as any).apply([kept]);
  assert.equal(res2.removed, 1);
  assert.equal(host.index['https://gone.example.com'], undefined);
  assert.ok(!vault.files.has('Reading List/Gone.md'));
  assert.ok(vault.files.has('Reading List/Keep.md'));
});

test('SyncEngine keeps notes for items present in the browser but filtered out of this sync', async () => {
  const { host, vault, app } = createSyncHost({ targetFolder: 'Reading List' });

  const engine = new SyncEngine(app as any, host, (date) => date.toISOString().slice(0, 10));

  const inScope = entry({ sourceId: '1', title: 'InScope', url: 'https://in.example.com' });
  const outOfScope = entry({ sourceId: '2', title: 'OutOfScope', url: 'https://out.example.com' });

  // Initial sync imports both.
  await (engine as any).apply([inScope, outOfScope]);
  assert.ok(vault.files.has('Reading List/OutOfScope.md'));

  // A source-side filter now drops `outOfScope` from `entries`, but it still exists in the
  // browser (present in `allBrowserEntries`), so its note must survive.
  const res = await (engine as any).apply([inScope], [inScope, outOfScope]);
  assert.equal(res.removed, 0);
  assert.equal(host.index['https://out.example.com'], 'Reading List/OutOfScope.md');
  assert.ok(vault.files.has('Reading List/OutOfScope.md'));
});
