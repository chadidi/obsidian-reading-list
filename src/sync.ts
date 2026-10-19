import { readReadingList } from './sources';
import type { ReadingListEntry, StoredEntry, SyncHost, SyncResult, SyncTrigger } from './types';

/** Normalises a freshly read item into the shape persisted for the dashboard. */
function toStored(entry: ReadingListEntry): StoredEntry {
  return {
    url: entry.url.trim(),
    title: entry.title,
    dateAdded: entry.dateAdded ? entry.dateAdded.getTime() : null,
    excerpt: entry.excerpt,
    read: entry.read,
    browser: entry.browser,
  };
}

export class SyncEngine {
  private running = false;

  constructor(private readonly host: SyncHost) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** Returns null if another sync is already in progress. Throws on source-level failures. */
  async run(trigger: SyncTrigger): Promise<SyncResult | null> {
    if (this.running) {
      this.host.log.warn(`Sync (${trigger}) skipped: a previous sync is still running`);
      return null;
    }
    this.running = true;
    const started = Date.now();
    try {
      const { entries } = await readReadingList(this.host.settings, this.host.log, {
        safariOverride: this.host.getSafariPickedBuffer?.() ?? null,
      });
      const result = this.replace(entries);
      result.durationMs = Date.now() - started;
      this.host.log.info(`Sync (${trigger}) finished`, result);
      return result;
    } finally {
      this.running = false;
    }
  }

  /**
   * Turns the freshly read items into the new dashboard state: drops blank URLs, keeps the first
   * occurrence of a duplicated URL, and reports how the list changed since the last sync. The new
   * list is handed to the host, which persists it and refreshes any open dashboard.
   */
  replace(entries: ReadingListEntry[]): SyncResult {
    const result: SyncResult = {
      total: 0,
      added: 0,
      removed: 0,
      unchanged: 0,
      duplicates: 0,
      durationMs: 0,
    };

    const previous = new Set(this.host.entries.map((entry) => entry.url));
    const seen = new Set<string>();
    const next: StoredEntry[] = [];

    for (const entry of entries) {
      const stored = toStored(entry);
      if (!stored.url) continue;
      if (seen.has(stored.url)) {
        result.duplicates++;
        continue;
      }
      seen.add(stored.url);
      next.push(stored);
      if (previous.has(stored.url)) result.unchanged++;
      else result.added++;
    }

    for (const url of previous) {
      if (!seen.has(url)) result.removed++;
    }

    result.total = next.length;
    this.host.setEntries(next);
    return result;
  }
}
