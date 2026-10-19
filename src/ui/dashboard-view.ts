import { ItemView, Menu, Notice, SearchComponent, setIcon, type App, type WorkspaceLeaf } from 'obsidian';
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

/** Formats an epoch millisecond timestamp into a human relative time. */
function formatRelativeTime(ms: number): string {
  if (!ms) return 'Never synced';
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 45) return 'Just synced';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Synced ${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `Synced ${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `Synced ${diffDays}d ago`;
  return `Synced ${formatDay(ms)}`;
}

export class ReadingListDashboardView extends ItemView {
  private query = '';
  private readFilter: ReadFilter = 'all';
  private sort: SortKey = 'added-desc';
  private searchVisible = false;
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

    // Center actions row
    const actions = toolbar.createDiv({ cls: 'rl-actions' });

    // Search row (togglable, placed directly below the actions row)
    const searchContainer = toolbar.createDiv({ cls: 'rl-search-container' });
    if (!this.searchVisible) searchContainer.addClass('is-hidden');

    const searchComponent = new SearchComponent(searchContainer);
    searchComponent.setPlaceholder('Search...');
    searchComponent.setValue(this.query);
    searchComponent.onChange((value) => {
      this.query = value;
      this.renderList();
    });

    const searchInput = searchComponent.inputEl;

    const createActionButton = (
      icon: string,
      ariaLabel: string,
      onClick: (event: MouseEvent) => void,
    ): HTMLButtonElement => {
      const btn = actions.createEl('button', {
        cls: 'clickable-icon nav-action-button rl-action-button',
        attr: { 'aria-label': ariaLabel, type: 'button' },
      });
      setIcon(btn, icon);
      btn.addEventListener('click', onClick);
      return btn;
    };

    const toggleSearch = (show?: boolean): void => {
      this.searchVisible = show ?? !this.searchVisible;
      searchToggleBtn.toggleClass('is-active', this.searchVisible);
      searchContainer.toggleClass('is-hidden', !this.searchVisible);
      if (this.searchVisible) {
        searchInput.focus();
        searchInput.select();
      } else {
        if (this.query) {
          this.query = '';
          searchComponent.setValue('');
          this.renderList();
        }
      }
    };

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        toggleSearch(false);
      }
    });

    // Sync button
    createActionButton('refresh-cw', 'Sync reading list', () => {
      void this.plugin.syncNow('manual');
    });

    // Filter button
    const filterBtn = createActionButton('filter', 'Filter by read state', (event) => {
      const menu = new Menu();
      for (const [value, label] of READ_FILTERS) {
        menu.addItem((item) => {
          item
            .setTitle(label)
            .setChecked(value === this.readFilter)
            .onClick(() => {
              this.readFilter = value;
              filterBtn.toggleClass('is-active', this.readFilter !== 'all');
              this.refresh();
            });
        });
      }
      menu.showAtMouseEvent(event);
    });
    if (this.readFilter !== 'all') filterBtn.addClass('is-active');

    // Sort button
    createActionButton('arrow-up-narrow-wide', 'Sort by', (event) => {
      const menu = new Menu();
      for (const [value, label] of SORTS) {
        menu.addItem((item) => {
          item
            .setTitle(label)
            .setChecked(value === this.sort)
            .onClick(() => {
              this.sort = value;
              this.refresh();
            });
        });
      }
      menu.showAtMouseEvent(event);
    });

    // Search toggle button
    const searchToggleBtn = createActionButton('search', 'Search', () => {
      toggleSearch();
    });
    if (this.searchVisible) searchToggleBtn.addClass('is-active');

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

    if (all.length === 0) {
      this.renderSummary(all);
      this.renderEmpty(
        listEl,
        'Your reading list is empty',
        'Run a sync to import items from your browser.',
      );
      return;
    }

    const visible = this.visibleEntries(all);
    this.renderSummary(all, visible.length);

    if (visible.length === 0) {
      this.renderEmpty(listEl, 'No matching items', 'Try a different search query or filter.');
      return;
    }

    for (const entry of visible) listEl.appendChild(this.renderItem(entry));
  }

  private renderSummary(all: StoredEntry[], visibleCount?: number): void {
    if (!this.countEl) return;
    const unread = all.filter((entry) => entry.read !== true).length;

    if (visibleCount !== undefined && visibleCount < all.length) {
      this.countEl.setText(`Showing ${visibleCount} of ${all.length}`);
    } else if (unread > 0) {
      this.countEl.setText(`${all.length} item${all.length === 1 ? '' : 's'} · ${unread} unread`);
    } else {
      this.countEl.setText(`${all.length} item${all.length === 1 ? '' : 's'} · All read`);
    }

    if (this.lastSyncEl) {
      this.lastSyncEl.setText(formatRelativeTime(this.plugin.lastSyncAt));
      if (this.plugin.lastSyncAt) {
        this.lastSyncEl.setAttribute(
          'title',
          `Last sync: ${new Date(this.plugin.lastSyncAt).toLocaleString()}`,
        );
      } else {
        this.lastSyncEl.removeAttribute('title');
      }
    }
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
    item.setAttribute('title', `${entry.title || entry.url}\n${entry.url}`);

    item.addEventListener('click', (event) => {
      // Middle click or modifier key opens in default external browser
      if (event.metaKey || event.ctrlKey || event.button === 1) {
        openExternal(entry.url);
        return;
      }
      void openPage(this.app, entry.url);
    });

    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const menu = new Menu();

      menu.addItem((i) =>
        i
          .setTitle('Open in Obsidian')
          .setIcon('book-open')
          .onClick(() => void openPage(this.app, entry.url)),
      );

      menu.addItem((i) =>
        i
          .setTitle('Open in default browser')
          .setIcon('external-link')
          .onClick(() => openExternal(entry.url)),
      );

      menu.addSeparator();

      menu.addItem((i) =>
        i
          .setTitle(entry.read ? 'Mark as unread' : 'Mark as read')
          .setIcon(entry.read ? 'circle' : 'check-circle')
          .onClick(async () => {
            entry.read = !entry.read;
            await this.plugin.saveSettings();
            this.renderList();
          }),
      );

      menu.addSeparator();

      menu.addItem((i) =>
        i
          .setTitle('Copy URL')
          .setIcon('copy')
          .onClick(() => {
            void navigator.clipboard.writeText(entry.url);
            new Notice('URL copied to clipboard');
          }),
      );

      menu.addItem((i) =>
        i
          .setTitle('Copy title')
          .setIcon('copy')
          .onClick(() => {
            void navigator.clipboard.writeText(entry.title || entry.url);
            new Notice('Title copied to clipboard');
          }),
      );

      menu.showAtMouseEvent(event);
    });

    // Unread indicator dot
    item.createSpan({ cls: 'rl-item-dot' });

    const main = item.createDiv({ cls: 'rl-item-main' });
    main.createDiv({
      cls: 'rl-item-title',
      text: entry.title || entry.url,
    });

    const meta = main.createDiv({ cls: 'rl-item-meta' });
    meta.createSpan({ cls: 'rl-item-domain', text: domainOf(entry.url) });
    if (entry.dateAdded !== null) {
      meta.createSpan({ cls: 'rl-item-separator', text: '•' });
      meta.createSpan({ cls: 'rl-item-date', text: formatDay(entry.dateAdded) });
    }
    if (entry.browser !== this.plugin.settings.browser) {
      meta.createSpan({ cls: 'rl-item-separator', text: '•' });
      meta.createSpan({ cls: 'rl-item-browser', text: BROWSER_LABELS[entry.browser] });
    }

    if (entry.excerpt.trim()) {
      main.createDiv({ cls: 'rl-item-excerpt', text: entry.excerpt.trim() });
    }

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
