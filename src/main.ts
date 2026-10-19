import { Notice, Plugin, addIcon, debounce, setIcon } from 'obsidian';
import { errorMessage } from './errors';
import { Logger } from './logger';
import { normalizeSettings } from './settings';
import { ReadingListSettingTab } from './settings-tab';
import { SyncEngine } from './sync';
import { READING_LIST_VIEW_TYPE, ReadingListDashboardView } from './ui/dashboard-view';
import {
  isBrowserType,
  type PluginData,
  type ReadingListSettings,
  type SafariPick,
  type StoredEntry,
  type SyncHost,
  type SyncResult,
  type SyncTrigger,
} from './types';

export default class ReadingListPlugin extends Plugin implements SyncHost {
  settings!: ReadingListSettings;
  /** Reading-list items from the last successful sync, rendered by the dashboard. */
  entries: StoredEntry[] = [];
  /** Epoch milliseconds of the last successful sync, or 0 when the plugin has never synced. */
  lastSyncAt = 0;
  readonly log = new Logger(() => this.settings?.debug ?? false);

  private engine!: SyncEngine;
  private intervalId: number | null = null;
  private lastAutomaticError = '';
  private readonly saveSoon = debounce(() => void this.persist(), 1000, true);
  /**
   * Safari Bookmarks.plist the user picked through the native dialog. macOS only grants access for
   * the current session, so this lives in memory and is intentionally never persisted.
   */
  private safariPick: SafariPick | null = null;

  async onload(): Promise<void> {
    await this.loadPluginData();

    this.engine = new SyncEngine(this);

    // Register the exact current Lucide book-open-text SVG so it looks identical to
    // lucide.dev/icons/book-open-text. Obsidian bundles an older Lucide version; addIcon() lets us
    // ship the up-to-date path. The paths are authored for a 24×24 canvas; scale(4.167) maps them
    // to Obsidian's required 100×100 viewBox.
    addIcon(
      'book-open-text',
      `<g transform="scale(4.167)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 7v14"/>
        <path d="M16 12h2"/>
        <path d="M16 8h2"/>
        <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>
        <path d="M6 12h2"/>
        <path d="M6 8h2"/>
      </g>`,
    );

    this.registerView(READING_LIST_VIEW_TYPE, (leaf) => new ReadingListDashboardView(leaf, this));

    // The dashboard is the plugin's main surface, so the ribbon icon opens it.
    this.addRibbonIcon('book-open-text', 'Open reading list', () => void this.openDashboard());
    this.addCommand({
      id: 'open-dashboard',
      name: 'Open dashboard',
      icon: 'book-open-text',
      callback: () => void this.openDashboard(),
    });
    this.addCommand({
      id: 'sync-now',
      name: 'Sync now',
      icon: 'refresh-cw',
      callback: () => void this.syncNow('manual'),
    });

    const settingTab = new ReadingListSettingTab(this.app, this);
    this.addSettingTab(settingTab);
    // Prepend the icon so it appears on the left, matching all other settings sidebar items.
    // setIcon() appends to the element, so we create a dedicated span, prepend it, then set the icon.
    const navEl = (settingTab as unknown as { navEl?: HTMLElement }).navEl;
    if (navEl) {
      const iconEl = navEl.createSpan({ cls: 'bb-settings-nav-icon' });
      navEl.prepend(iconEl);
      setIcon(iconEl, 'book-open-text');
    }

    this.schedulePeriodicSync();
    if (this.settings.syncOnStartup) {
      this.app.workspace.onLayoutReady(() => void this.syncNow('startup'));
    }
    this.log.debug('Plugin loaded');
  }

  onunload(): void {
    // The interval is registered via registerInterval() and views are unloaded by Obsidian.
    void this.persist();
    this.log.debug('Plugin unloaded');
  }

  /* ------------------------------------------------------------------ */
  /* Dashboard                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Opens the dashboard in the left sidebar as a tab, next to the core Bookmarks panel,
   * focusing the existing panel when one is already open.
   */
  async openDashboard(): Promise<void> {
    await this.app.workspace.ensureSideLeaf(READING_LIST_VIEW_TYPE, 'left', {
      active: true,
      reveal: true,
    });
  }

  /** Re-renders every open dashboard, e.g. right after a sync imported new items. */
  refreshDashboards(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(READING_LIST_VIEW_TYPE)) {
      if (leaf.view instanceof ReadingListDashboardView) leaf.view.refresh();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Scheduling                                                          */
  /* ------------------------------------------------------------------ */

  /** (Re)creates the background timer from the current settings. Safe to call repeatedly. */
  schedulePeriodicSync(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    const minutes = this.settings.intervalMinutes;
    if (!Number.isFinite(minutes) || minutes <= 0) {
      this.log.info('Periodic sync is disabled');
      return;
    }
    const ms = minutes * 60 * 1000;
    this.intervalId = this.registerInterval(
      window.setInterval(() => void this.syncNow('periodic'), ms),
    );
    this.log.info(`Periodic sync scheduled every ${minutes} minute(s)`);
  }

  /* ------------------------------------------------------------------ */
  /* Sync entry point with error boundary                                */
  /* ------------------------------------------------------------------ */

  async syncNow(trigger: SyncTrigger): Promise<void> {
    const manual = trigger === 'manual';

    if (!manual && !this.settings.initialSyncDone) {
      this.log.info(`Automatic (${trigger}) sync skipped: run one manual sync first`);
      return;
    }

    const progress = manual ? new Notice('Syncing reading list…', 0) : null;
    try {
      const result = await this.engine.run(trigger);
      if (!result) {
        if (manual) new Notice('A reading list sync is already running.');
        return;
      }
      this.lastAutomaticError = '';
      if (!this.settings.initialSyncDone) {
        this.settings.initialSyncDone = true;
        await this.saveSettings();
      }
      if (manual) new Notice(this.summarize(result), 6000);
    } catch (err) {
      const message = errorMessage(err);
      this.log.error(`Sync (${trigger}) failed: ${message}`, err);
      // Don't repeat the same background error as a popup every interval.
      if (manual || message !== this.lastAutomaticError) {
        new Notice(`Reading list sync failed: ${message}`, 10000);
      }
      if (!manual) this.lastAutomaticError = message;
    } finally {
      progress?.hide();
    }
  }

  private summarize(r: SyncResult): string {
    const parts = [`${r.total} item${r.total === 1 ? '' : 's'}`];
    if (r.added) parts.push(`${r.added} new`);
    if (r.removed) parts.push(`${r.removed} removed`);
    if (r.duplicates) parts.push(`${r.duplicates} duplicate URLs ignored`);
    return `Reading list sync complete: ${parts.join(', ')} (${(r.durationMs / 1000).toFixed(1)}s).`;
  }

  /* ------------------------------------------------------------------ */
  /* Persistence                                                         */
  /* ------------------------------------------------------------------ */

  private async loadPluginData(): Promise<void> {
    const raw = (await this.loadData()) as Partial<PluginData> | null;
    this.settings = normalizeSettings(raw?.settings);
    this.entries = this.normalizeEntries(raw?.entries);
    this.lastSyncAt = typeof raw?.lastSyncAt === 'number' ? raw.lastSyncAt : 0;
  }

  /** Drops malformed items so a hand-edited data.json can never break the dashboard. */
  private normalizeEntries(raw: unknown): StoredEntry[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const entries: StoredEntry[] = [];
    for (const item of raw as Partial<StoredEntry>[]) {
      if (!item || typeof item.url !== 'string' || !item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      entries.push({
        url: item.url,
        title: typeof item.title === 'string' ? item.title : '',
        dateAdded: typeof item.dateAdded === 'number' ? item.dateAdded : null,
        excerpt: typeof item.excerpt === 'string' ? item.excerpt : '',
        read: typeof item.read === 'boolean' ? item.read : null,
        browser: isBrowserType(item.browser) ? item.browser : this.settings.browser,
      });
    }
    return entries;
  }

  private async persist(): Promise<void> {
    try {
      const data: PluginData = {
        settings: this.settings,
        entries: this.entries,
        lastSyncAt: this.lastSyncAt,
      };
      await this.saveData(data);
    } catch (err) {
      this.log.error('Could not save plugin data', err);
    }
  }

  async saveSettings(): Promise<void> {
    await this.persist();
  }

  /* ------------------------------------------------------------------ */
  /* SyncHost                                                            */
  /* ------------------------------------------------------------------ */

  setEntries(entries: StoredEntry[]): void {
    this.entries = entries;
    this.lastSyncAt = Date.now();
    this.saveSoon();
    this.refreshDashboards();
  }

  /** The in-memory Safari pick for this session, if the user has chosen a Bookmarks.plist. */
  getSafariPick(): SafariPick | null {
    return this.safariPick;
  }

  setSafariPick(pick: SafariPick | null): void {
    this.safariPick = pick;
  }

  getSafariPickedBuffer(): Buffer | null {
    return this.safariPick?.buffer ?? null;
  }
}
