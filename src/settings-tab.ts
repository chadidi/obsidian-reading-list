import {
  App,
  PluginSettingTab,
  type SettingDefinitionItem,
  type SettingGroupItem,
  debounce,
} from 'obsidian';
import type ReadingListPlugin from './main';
import { checkSourceAccess, defaultBrowserPath } from './paths';
import { BROWSER_LABELS, type BrowserType } from './types';
import { SafariPickerModal } from './ui/safari-picker-modal';

const PATH_HELP: Record<BrowserType, string> = {
  chrome:
    'The Google Chrome Bookmarks (or AccountBookmarks) JSON file inside your profile folder. For a ' +
    'different profile, enter its Bookmarks file here.',
  edge:
    'The Microsoft Edge Bookmarks JSON file inside your profile folder. For a different profile, ' +
    'enter its Bookmarks file here.',
  chromium:
    'The Bookmarks JSON file of Chromium or another Chromium-based browser (Brave, Edge...). ' +
    'For a different profile, enter its Bookmarks file here.',
  firefox:
    'Firefox has no reading list, so the plugin imports bookmarks instead. Point this at ' +
    'places.sqlite (live data, read with the SQLite module built into Obsidian) or a ' +
    "bookmarkbackups *.jsonlz4 file / folder (only as fresh as Firefox's last daily backup).",
  safari:
    "Safari's binary Bookmarks.plist (macOS only), which also stores the Safari Reading List. " +
    'Select it with the button below to grant access without Full Disk Access, or point this ' +
    'field at a copy of the file.',
};

/** What the user can do to let the plugin read the selected browser's reading list. */
const ACCESS_HINT: Record<BrowserType, string> = {
  chrome:
    'Open Google Chrome and bookmark at least one page into your reading-list folder, then reopen this tab.',
  edge:
    'Open Microsoft Edge and add at least one favorite into your reading-list folder, then reopen this tab.',
  chromium:
    'Open Chromium and bookmark at least one page into your reading-list folder, then reopen this tab.',
  firefox:
    'Open Mozilla Firefox at least once (or let it create a daily bookmark backup), then reopen this tab.',
  safari:
    'Select ~/Library/Safari/Bookmarks.plist with the button above to grant access, or grant Obsidian ' +
    'Full Disk Access in System Settings → Privacy & Security, then reopen this tab.',
};

export class ReadingListSettingTab extends PluginSettingTab {
  icon = 'book-open-text';

  private readonly saveSoon = debounce(() => void this.plugin.saveSettings(), 500, true);
  private readonly rescheduleSoon = debounce(() => this.plugin.schedulePeriodicSync(), 800, true);

  constructor(
    app: App,
    private readonly plugin: ReadingListPlugin,
  ) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const settings = this.plugin.settings;
    const browser = settings.browser;
    const sourceItems = this.sourceItems(browser);

    // Everything below depends on actually being able to read the browser's reading list,
    // so keep it hidden until that access is granted.
    const access = checkSourceAccess(browser, settings.paths[browser]);
    const hasSafariPick = browser === 'safari' && this.plugin.getSafariPick() !== null;
    if (!access.accessible && !hasSafariPick) {
      return [
        { type: 'group', heading: 'Source', items: sourceItems },
        this.accessWarningItem(browser),
      ];
    }

    return [
      { type: 'group', heading: 'Source', items: sourceItems },
      { type: 'group', heading: 'Dashboard', items: this.dashboardItems() },
      { type: 'group', heading: 'Automation', items: this.automationItems() },
    ];
  }

  /* ------------------------------------------------------------------ */
  /* Source                                                              */
  /* ------------------------------------------------------------------ */

  private sourceItems(browser: BrowserType): SettingGroupItem[] {
    const settings = this.plugin.settings;
    const items: SettingGroupItem[] = [];

    items.push({
      name: 'Browser',
      desc: "Which browser's reading list to import.",
      render: (setting) => {
        setting.addDropdown((dd) =>
          dd
            .addOptions({
              chrome: BROWSER_LABELS.chrome,
              edge: BROWSER_LABELS.edge,
              chromium: `${BROWSER_LABELS.chromium} (Brave, Arc...)`,
              firefox: `${BROWSER_LABELS.firefox} (bookmarks)`,
              safari: `${BROWSER_LABELS.safari} (macOS)`,
            })
            .setValue(settings.browser)
            .onChange(async (value) => {
              settings.browser = value as BrowserType;
              await this.plugin.saveSettings();
              // The path help, the extra fields, and the access gate depend on the browser.
              this.update();
            }),
        );
      },
    });

    items.push({
      name: 'Reading list file path',
      desc: this.pathDescription(browser, settings.paths[browser]),
      render: (setting) => {
        setting
          .addText((text) => {
            text
              .setPlaceholder(defaultBrowserPath(browser) || 'No default for this platform')
              .setValue(settings.paths[browser])
              .onChange((value) => {
                settings.paths[browser] = value.trim();
                this.saveSoon();
              });
            text.inputEl.addClass('bb-wide-input');
          })
          .addExtraButton((btn) =>
            btn
              .setIcon('rotate-ccw')
              .setTooltip('Use the detected default')
              .onClick(async () => {
                settings.paths[browser] = '';
                await this.plugin.saveSettings();
                this.update();
              }),
          );
        setting.descEl.addClass('bb-path-desc');
      },
    });

    if (browser === 'chrome') {
      items.push({
        name: 'Google Chrome bookmarks folder',
        desc: createFragment((frag) => {
          frag.appendText(
            'Google Chrome stores reading-list entries in an internal database, so the plugin imports bookmarks ' +
              'from a folder instead. Use ',
          );
          frag.createEl('code', { text: '/' });
          frag.appendText(' to separate nested folders, e.g. ');
          frag.createEl('code', { text: 'Other bookmarks/reading list' });
          frag.appendText(
            '. Matching is case-insensitive. Leave empty to import nothing from Chrome.',
          );
        }),
        render: (setting) => {
          setting
            .addText((text) => {
              text
                .setPlaceholder('E.g. Other bookmarks/reading list (leave empty to disable)')
                .setValue(settings.chromeFolder)
                .onChange((value) => {
                  settings.chromeFolder = value.trim();
                  this.saveSoon();
                });
              text.inputEl.addClass('bb-wide-input');
            })
            .addExtraButton((btn) =>
              btn
                .setIcon('x')
                .setTooltip('Clear: import nothing from chrome')
                .onClick(async () => {
                  settings.chromeFolder = '';
                  await this.plugin.saveSettings();
                  this.update();
                }),
            );
        },
      });
    }

    if (browser === 'edge') {
      items.push({
        name: 'Microsoft Edge favorites folder',
        desc: createFragment((frag) => {
          frag.appendText(
            'Microsoft Edge stores reading-list entries in an internal database, so the plugin imports favorites ' +
              'from a folder instead. Use ',
          );
          frag.createEl('code', { text: '/' });
          frag.appendText(' to separate nested folders, e.g. ');
          frag.createEl('code', { text: 'Other favorites/reading list' });
          frag.appendText(
            '. Matching is case-insensitive. Leave empty to import nothing from Edge.',
          );
        }),
        render: (setting) => {
          setting
            .addText((text) => {
              text
                .setPlaceholder('E.g. Other favorites/reading list (leave empty to disable)')
                .setValue(settings.edgeFolder)
                .onChange((value) => {
                  settings.edgeFolder = value.trim();
                  this.saveSoon();
                });
              text.inputEl.addClass('bb-wide-input');
            })
            .addExtraButton((btn) =>
              btn
                .setIcon('x')
                .setTooltip('Clear: import nothing from edge')
                .onClick(async () => {
                  settings.edgeFolder = '';
                  await this.plugin.saveSettings();
                  this.update();
                }),
            );
        },
      });
    }

    if (browser === 'chromium') {
      items.push({
        name: 'Chromium bookmarks folder',
        desc: createFragment((frag) => {
          frag.appendText(
            'Chromium stores reading-list entries in an internal database, so the plugin imports bookmarks ' +
              'from a folder instead. Use ',
          );
          frag.createEl('code', { text: '/' });
          frag.appendText(' to separate nested folders, e.g. ');
          frag.createEl('code', { text: 'Other bookmarks/reading list' });
          frag.appendText(
            '. Matching is case-insensitive. Leave empty to import nothing from Chromium.',
          );
        }),
        render: (setting) => {
          setting
            .addText((text) => {
              text
                .setPlaceholder('E.g. Other bookmarks/reading list (leave empty to disable)')
                .setValue(settings.chromiumFolder)
                .onChange((value) => {
                  settings.chromiumFolder = value.trim();
                  this.saveSoon();
                });
              text.inputEl.addClass('bb-wide-input');
            })
            .addExtraButton((btn) =>
              btn
                .setIcon('x')
                .setTooltip('Clear: import nothing from chromium')
                .onClick(async () => {
                  settings.chromiumFolder = '';
                  await this.plugin.saveSettings();
                  this.update();
                }),
            );
        },
      });
    }

    if (browser === 'firefox') {
      items.push({
        name: 'Firefox bookmarks folder',
        desc: createFragment((frag) => {
          frag.appendText(
            'Firefox has no native reading list, so the plugin imports bookmarks from one folder ' +
              'instead. Use ',
          );
          frag.createEl('code', { text: '/' });
          frag.appendText(' to separate nested folders, e.g. ');
          frag.createEl('code', { text: 'Reading list' });
          frag.appendText(
            '. Matching is case-insensitive. Leave empty to import nothing from Firefox.',
          );
        }),
        render: (setting) => {
          setting
            .addText((text) => {
              text
                .setPlaceholder('E.g. Reading list (leave empty to disable)')
                .setValue(settings.firefoxFolder)
                .onChange((value) => {
                  settings.firefoxFolder = value.trim();
                  this.saveSoon();
                });
              text.inputEl.addClass('bb-wide-input');
            })
            .addExtraButton((btn) =>
              btn
                .setIcon('x')
                .setTooltip('Clear: import nothing from firefox')
                .onClick(async () => {
                  settings.firefoxFolder = '';
                  await this.plugin.saveSettings();
                  this.update();
                }),
            );
        },
      });
    }

    if (browser === 'safari') {
      items.push(this.safariPickerItem());
    }

    return items;
  }

  /** Full-width warning shown as its own block, outside the Source block, until access is granted. */
  private accessWarningItem(browser: BrowserType): SettingDefinitionItem {
    return {
      type: 'group',
      cls: 'bb-callout',
      items: [
        {
          name: '',
          desc:
            `Can't read the ${BROWSER_LABELS[browser]} reading list yet. ${ACCESS_HINT[browser]} ` +
            'The rest of the settings will appear once access is granted.',
          searchable: false,
          render: (setting) => {
            setting.descEl.addClass('bb-warning');
          },
        },
      ],
    };
  }

  /**
   * Lets the user hand the plugin a Safari Bookmarks.plist through the native file picker.
   * Picking the file grants macOS read access to just that file for this session, so the field
   * above can stay empty and Full Disk Access is not required.
   */
  private safariPickerItem(): SettingGroupItem {
    const pick = this.plugin.getSafariPick();
    return {
      name: 'Safari reading list file',
      desc: pick
        ? `Using the file you selected this session: ${pick.fileName}. macOS keeps this access ` +
          'until Obsidian is closed.'
        : 'macOS protects ~/Library/Safari/, so the path above may not be readable on its own. ' +
          'Select Bookmarks.plist below to grant read access for this session. Full Disk ' +
          'Access is not required.',
      render: (setting) => {
        setting.addButton((btn) =>
          btn
            .setButtonText(pick ? 'Choose a different file' : 'Choose Bookmarks.plist')
            .setCta()
            .onClick(() => {
              new SafariPickerModal(this.app, this.plugin.log, (picked) => {
                this.plugin.setSafariPick(picked);
                this.update();
              }).open();
            }),
        );
        if (pick) {
          setting.addExtraButton((btn) =>
            btn
              .setIcon('x')
              .setTooltip('Forget the selected file')
              .onClick(() => {
                this.plugin.setSafariPick(null);
                this.update();
              }),
          );
        }
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* Dashboard                                                           */
  /* ------------------------------------------------------------------ */

  private dashboardItems(): SettingGroupItem[] {
    const items = this.plugin.entries.length;
    return [
      {
        name: 'Reading list dashboard',
        desc:
          items > 0
            ? `Your reading list lives in the dashboard panel instead of one note per item, and these ` +
              `settings keep this list in sync. Currently holding ${items} item${items === 1 ? '' : 's'}.`
            : 'Your reading list lives in the dashboard panel instead of one note per item. ' +
              'Open it from the ribbon icon, the command palette, or the button below.',
        render: (setting) => {
          setting.addButton((btn) =>
            btn
              .setButtonText('Open dashboard')
              .setCta()
              .onClick(() => void this.plugin.openDashboard()),
          );
        },
      },
    ];
  }

  /* ------------------------------------------------------------------ */
  /* Automation                                                          */
  /* ------------------------------------------------------------------ */

  private automationItems(): SettingGroupItem[] {
    const settings = this.plugin.settings;
    return [
      {
        name: 'Sync interval (minutes)',
        desc:
          'How often to sync in the background. Use 0 to disable. Automatic syncs only start after you have ' +
          'run one manual sync successfully, so nothing is imported by surprise. ' +
          'We recommend 10 minutes or more.',
        render: (setting) => {
          let errorEl: HTMLElement | null = null;
          const refreshError = (invalid: boolean) => {
            if (!errorEl) return;
            errorEl.setText(invalid ? 'Enter a whole number of minutes (0 or more).' : '');
            errorEl.toggle(invalid);
          };
          setting.addText((text) => {
            text.inputEl.type = 'number';
            text.inputEl.min = '0';
            text.inputEl.step = '1';

            // Stack the error message directly under the input instead of after the whole row.
            const control = text.inputEl.parentElement;
            if (control) {
              const wrap = control.createDiv({ cls: 'bb-interval-input' });
              wrap.appendChild(text.inputEl);
              errorEl = wrap.createDiv({ cls: 'setting-item-description bb-error' });
            }

            text
              .setPlaceholder('0')
              .setValue(String(settings.intervalMinutes))
              .onChange((value) => {
                const minutes = Number(value);
                // Accept only unsigned integers; show a red error and keep the previous value otherwise.
                const invalid = value.trim() !== '' && (!Number.isInteger(minutes) || minutes < 0);
                if (invalid) {
                  refreshError(true);
                  return;
                }
                settings.intervalMinutes = Math.min(minutes, 10080);
                this.saveSoon();
                this.rescheduleSoon();
                refreshError(false);
              });
          });
        },
      },
      {
        name: 'Sync on startup',
        desc: 'Run a sync once Obsidian has finished loading.',
        render: (setting) => {
          setting.addToggle((toggle) =>
            toggle.setValue(settings.syncOnStartup).onChange(async (value) => {
              settings.syncOnStartup = value;
              await this.plugin.saveSettings();
            }),
          );
        },
      },
      {
        name: 'Sync now',
        desc: 'Run a sync immediately.',
        render: (setting) => {
          setting.addButton((btn) =>
            btn
              .setButtonText('Sync reading list')
              .setCta()
              .onClick(async () => {
                btn.setDisabled(true);
                try {
                  await this.plugin.syncNow('manual');
                } finally {
                  btn.setDisabled(false);
                }
              }),
          );
        },
      },
    ];
  }

  /** Shows what the field currently resolves to and whether it can be read. */
  private pathDescription(browser: BrowserType, configured: string): DocumentFragment {
    return createFragment((frag) => {
      frag.appendText(PATH_HELP[browser]);
      frag.createEl('br');
      const access = checkSourceAccess(browser, configured);
      if (!access.resolved) {
        frag.appendText(access.error ?? 'No reading-list location is known for this platform.');
        return;
      }
      frag.appendText(configured.trim() ? 'Using: ' : 'Detected default: ');
      frag.createEl('code', { text: access.resolved });
      if (!access.exists) frag.appendText(' (not found)');
      else if (!access.accessible) frag.appendText(' (no permission)');
      else frag.appendText(' (found)');
    });
  }
}
