import { ItemView, Notice, setIcon, type App, type WorkspaceLeaf } from 'obsidian';
import type ReadingListPlugin from '../main';
import { BROWSER_LABELS, type StoredEntry } from '../types';

/** Workspace view type id for the reading-list dashboard panel. */
export const READING_LIST_VIEW_TYPE = 'reading-list-dashboard';

type ReadFilter = 'all' | 'unread' | 'read';
type SortKey = 'added-desc' | 'added-asc' | 'title-asc' | 'title-desc';

const READ_FILTERS: ReadonlyArray<readonly [ReadFilter, string]> = [
  ['all', 'All items'],
  ['unread', 'Unread'],
  ['read', 'Read'],
];

const SORTS: ReadonlyArray<readonly [SortKey, string]> = [
  ['added-desc', 'Newest first'],
  ['added-asc', 'Oldest first'],
  ['title-asc', 'Title A-Z'],
  ['title-desc', 'Title Z-A'],
];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local YYYY-MM-DD for an epoch-millisecond timestamp. */
function formatDay(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Core Web Viewer view type, used to open pages as tabs in the main workspace. */
const WEB_VIEWER_VIEW_TYPE = 'webviewer';

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener');
}

/**
 * Whether the core Web Viewer plugin is enabled.
 */
function webViewerAvailable(app: App): boolean {
  const internal = (
    app as unknown as {
      internalPlugins?: { getPluginById(id: string): { enabled?: boolean } | undefined };
    }
  ).internalPlugins;
  return internal?.getPluginById(WEB_VIEWER_VIEW_TYPE)?.enabled === true;
}

/** Opens a page as a new tab in the main workspace. */
async function openPage(app: App, url: string): Promise<void> {
  if (!webViewerAvailable(app)) {
    new Notice(
      'Obsidian "Web viewer" core plugin is disabled. Opening in your default browser instead. ' +
        'Enable it in Settings → Core plugins to read inside Obsidian.',
      10000,
    );
    openExternal(url);
    return;
  }

  const leaf = app.workspace.getLeaf(true);
  await leaf.setViewState({
    type: WEB_VIEWER_VIEW_TYPE,
    active: true,
    state: { url },
  });
}

/** Sets up a click listener to open the page in Obsidian. */
function setupInternalLink(app: App, el: HTMLElement, url: string): void {
  el.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openPage(app, url);
  });
}

export class ReadingListDashboardView extends ItemView {
  private query = '';
  private readFilter: ReadFilter = 'all';
  private sort: SortKey = 'added-desc';
  private countEl: HTMLElement | null = null;
  private lastSyncEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ReadingListPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return READING_LIST_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Reading list';
  }

  getIcon(): string {
    return 'book-open-text';
  }

  async onOpen(): Promise<void> {
    this.buildLayout();
  }

  /** Re-renders the list; called after every sync and when settings change. */
  refresh(): void {
    this.renderList();
  }

  /* ------------------------------------------------------------------ */

  private buildLayout(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('rl-dashboard');

    const toolbar = root.createDiv({ cls: 'rl-toolbar' });

    const search = toolbar.createEl('input', {
      cls: 'rl-search',
      type: 'search',
      placeholder: 'Search title or URL',
    });
    search.value = this.query;
    search.addEventListener('input', () => {
      this.query = search.value;
      this.renderList();
    });

    const filter = toolbar.createEl('select', { cls: 'dropdown rl-select' });
    for (const [value, label] of READ_FILTERS) {
      const option = filter.createEl('option', { value, text: label });
      option.selected = value === this.readFilter;
    }
    filter.addEventListener('change', () => {
      this.readFilter = filter.value as ReadFilter;
      this.renderList();
    });

    const sort = toolbar.createEl('select', { cls: 'dropdown rl-select' });
    for (const [value, label] of SORTS) {
      const option = sort.createEl('option', { value, text: label });
      option.selected = value === this.sort;
    }
    sort.addEventListener('change', () => {
      this.sort = sort.value as SortKey;
      this.renderList();
    });

    const syncBtn = toolbar.createEl('button', { cls: 'rl-sync' });
    setIcon(syncBtn.createSpan({ cls: 'rl-sync-icon' }), 'refresh-cw');
    syncBtn.createSpan({ text: 'Sync' });
    syncBtn.addEventListener('click', () => void this.plugin.syncNow('manual'));

    const summary = root.createDiv({ cls: 'rl-summary' });
    this.countEl = summary.createDiv({ cls: 'rl-count' });
    this.lastSyncEl = summary.createDiv({ cls: 'rl-last-sync' });

    this.listEl = root.createDiv({ cls: 'rl-list' });
    this.renderList();
  }

  private renderList(): void {
    const listEl = this.listEl;
    if (!listEl) return;
    listEl.empty();

    const all = this.plugin.entries;
    this.renderSummary(all);

    if (all.length === 0) {
      this.renderEmpty(
        listEl,
        'Your reading list is empty',
        'Run a sync to import items from your browser.',
      );
      return;
    }

    const visible = this.visibleEntries(all);
    if (visible.length === 0) {
      this.renderEmpty(listEl, 'No items match your filters', 'Try a different search or filter.');
      return;
    }

    for (const entry of visible) listEl.appendChild(this.renderItem(entry));
  }

  private renderSummary(all: StoredEntry[]): void {
    if (!this.countEl) return;
    const unread = all.filter((entry) => entry.read !== true).length;
    this.countEl.setText(`${all.length} item${all.length === 1 ? '' : 's'}, ${unread} unread`);
    this.lastSyncEl?.setText(
      this.plugin.lastSyncAt
        ? `Last sync: ${new Date(this.plugin.lastSyncAt).toLocaleString()}`
        : 'Never synced',
    );
  }

  private visibleEntries(all: StoredEntry[]): StoredEntry[] {
    const needle = this.query.trim().toLowerCase();
    const filtered = all.filter((entry) => {
      if (this.readFilter === 'read' && entry.read !== true) return false;
      if (this.readFilter === 'unread' && entry.read === true) return false;
      if (!needle) return true;
      return entry.title.toLowerCase().includes(needle) || entry.url.toLowerCase().includes(needle);
    });
    return filtered.sort((a, b) => this.compare(a, b));
  }

  private compare(a: StoredEntry, b: StoredEntry): number {
    switch (this.sort) {
      case 'added-asc':
        return compareDates(a.dateAdded, b.dateAdded, true);
      case 'title-asc':
        return compareTitles(a, b);
      case 'title-desc':
        return compareTitles(b, a);
      default:
        return compareDates(a.dateAdded, b.dateAdded, false);
    }
  }

  private renderItem(entry: StoredEntry): HTMLElement {
    const item = createDiv({ cls: 'rl-item' });
    if (entry.read === true) item.addClass('is-read');

    item.addEventListener('click', (event) => {
      // Don't trigger if the external button or the title link was clicked
      const target = event.target as HTMLElement;
      if (target.closest('.rl-item-open') || target.closest('.rl-item-title')) {
        return;
      }
      void openPage(this.app, entry.url);
    });

    const main = item.createDiv({ cls: 'rl-item-main' });
    const title = main.createDiv({
      cls: 'rl-item-title',
      text: entry.title || entry.url,
      title: entry.url,
    });
    setupInternalLink(this.app, title, entry.url);

    const meta = main.createDiv({ cls: 'rl-item-meta' });
    meta.createSpan({ cls: 'rl-item-domain', text: domainOf(entry.url) });
    if (entry.dateAdded !== null) meta.createSpan({ text: formatDay(entry.dateAdded) });
    if (entry.browser !== this.plugin.settings.browser) {
      meta.createSpan({ text: BROWSER_LABELS[entry.browser] });
    }
    if (entry.read !== null) {
      const badge = meta.createSpan({ cls: 'rl-item-badge' });
      setIcon(badge.createSpan({ cls: 'rl-item-badge-icon' }), entry.read ? 'check' : 'circle');
      badge.createSpan({ text: entry.read ? 'Read' : 'Unread' });
    }

    if (entry.excerpt.trim()) {
      main.createDiv({ cls: 'rl-item-excerpt', text: entry.excerpt.trim() });
    }

    const openBtn = item.createEl('button', {
      cls: 'rl-item-open',
      attr: { 'aria-label': 'Open in default browser' },
    });
    setIcon(openBtn, 'external-link');
    openBtn.addEventListener('click', () => openExternal(entry.url));

    return item;
  }

  private renderEmpty(parent: HTMLElement, title: string, hint: string): void {
    const box = parent.createDiv({ cls: 'rl-empty' });
    box.createDiv({ cls: 'rl-empty-title', text: title });
    box.createDiv({ cls: 'rl-empty-hint', text: hint });
  }
}

/** Compares two optional timestamps; items without a date always sort last. */
function compareDates(a: number | null, b: number | null, ascending: boolean): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return ascending ? a - b : b - a;
}

function compareTitles(a: StoredEntry, b: StoredEntry): number {
  return (a.title || a.url).localeCompare(b.title || b.url);
}
