import {
  App,
  PluginSettingTab,
  type SettingDefinitionItem,
  type SettingGroupItem,
  debounce,
} from 'obsidian';
import { BROWSER_NAMES, detectBrowsersSync, detectDefaultBrowserId } from 'browsers-detect';
import type ReadingListPlugin from './main';
import { checkSourceAccess } from './paths';
import { defaultBookmarksFolder } from './settings';
import { BROWSER_LABELS, type BrowserType } from './types';
import { SafariPickerModal } from './ui/safari-picker-modal';

/** What the user can do to let the plugin read the selected browser's reading list. */
function accessHint(browser: BrowserType): string {
  if (browser === 'safari') {
    return (
      'Select ~/Library/Safari/Bookmarks.plist with the button below to grant access, or grant Obsidian ' +
      'Full Disk Access in System Settings → Privacy & Security, then reopen this tab.'
    );
  }
  return `Open ${BROWSER_LABELS[browser]} at least once so it saves bookmarks locally, then reopen this tab.`;
}

export class ReadingListSettingTab extends PluginSettingTab {
  icon = 'book-open-text';

  private defaultBrowserId: BrowserType | undefined;
  private readonly saveSoon = debounce(() => void this.plugin.saveSettings(), 500, true);
  private readonly rescheduleSoon = debounce(() => this.plugin.schedulePeriodicSync(), 800, true);

  constructor(
    app: App,
    private readonly plugin: ReadingListPlugin,
  ) {
    super(app, plugin);
    void detectDefaultBrowserId().then((browserId) => {
      if (!browserId || browserId === this.defaultBrowserId) return;
      this.defaultBrowserId = browserId;
      this.update();
    });
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const settings = this.plugin.settings;
    const browser = settings.browser;
    const sourceItems = this.sourceItems(browser);

    // Everything below depends on actually being able to read the browser's reading list,
    // so keep it hidden until that access is granted.
    const access = checkSourceAccess(browser, settings.profiles[browser]);
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
    const detectedBrowsers = detectBrowsersSync();
    const browserOptions = Object.fromEntries(
      detectedBrowsers
        .filter((candidate) => candidate.installed || candidate.profiles.length > 0)
        .map((candidate) => [
          candidate.id,
          `${candidate.name}${candidate.id === this.defaultBrowserId ? ' (system default)' : ''}`,
        ]),
    ) as Record<string, string>;
    if (!browserOptions[browser]) browserOptions[browser] = BROWSER_NAMES[browser];
    const selectedBrowser = detectedBrowsers.find((candidate) => candidate.id === browser);
    const profiles = selectedBrowser?.profiles ?? [];
    const selectedProfile =
      profiles.find((profile) => profile.id === settings.profiles[browser]) ??
      profiles.find((profile) => profile.isDefault && profile.bookmarkPaths.length > 0) ??
      profiles.find((profile) => profile.isDefault) ??
      profiles[0];
    const items: SettingGroupItem[] = [];

    items.push({
      name: 'Browser',
      desc: "Which browser's reading list to import.",
      render: (setting) => {
        setting.addDropdown((dd) =>
          dd
            .addOptions(browserOptions)
            .setValue(settings.browser)
            .onChange(async (value) => {
              settings.browser = value as BrowserType;
              settings.bookmarksFolder = defaultBookmarksFolder(settings.browser);
              const nextBrowser = detectedBrowsers.find((candidate) => candidate.id === value);
              const nextProfile =
                nextBrowser?.profiles.find(
                  (profile) => profile.isDefault && profile.bookmarkPaths.length > 0,
                ) ??
                nextBrowser?.profiles.find((profile) => profile.isDefault) ??
                nextBrowser?.profiles[0];
              settings.profiles[settings.browser] = nextProfile?.id ?? '';
              await this.plugin.saveSettings();
              // The profile list and access gate depend on the browser.
              this.update();
            }),
        );
      },
    });

    items.push({
      name: 'Profile',
      desc: this.profileDescription(browser, selectedProfile?.id ?? settings.profiles[browser]),
      render: (setting) => {
        if (!profiles.length) return;
        const profileOptions = Object.fromEntries(
          profiles.map((profile) => [
            profile.id,
            `${profile.name}${profile.isDefault ? ' (default)' : ''}`,
          ]),
        );
        setting.addDropdown((dd) =>
          dd
            .addOptions(profileOptions)
            .setValue(selectedProfile?.id ?? profiles[0]?.id ?? '')
            .onChange(async (value) => {
              settings.profiles[browser] = value;
              await this.plugin.saveSettings();
              this.update();
            }),
        );
      },
    });

    if (browser !== 'safari') {
      items.push({
        name: 'Bookmarks folder',
        desc: createFragment((frag) => {
          frag.appendText('Import bookmarks from a folder matching this name or path. Use ');
          frag.createEl('code', { text: '/' });
          frag.appendText(' to separate nested folders, e.g. ');
          frag.createEl('code', { text: 'Reading list' });
          frag.appendText('. Matching is case-insensitive. Leave empty to import nothing.');
        }),
        render: (setting) => {
          setting
            .addText((text) => {
              text
                .setPlaceholder('E.g. Reading list (leave empty to disable)')
                .setValue(settings.bookmarksFolder)
                .onChange((value) => {
                  settings.bookmarksFolder = value.trim();
                  this.saveSoon();
                });
            })
            .addExtraButton((btn) =>
              btn
                .setIcon('rotate-ccw')
                .setTooltip('Reset to default')
                .onClick(async () => {
                  settings.bookmarksFolder = defaultBookmarksFolder(browser);
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
            `Can't read the ${BROWSER_LABELS[browser]} reading list yet. ${accessHint(browser)} ` +
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

  /** Shows the selected profile's detected bookmark file and whether it can be read. */
  private profileDescription(browser: BrowserType, profileId: string): DocumentFragment {
    return createFragment((frag) => {
      const detected = detectBrowsersSync().find((candidate) => candidate.id === browser);
      const profile = detected?.profiles.find((candidate) => candidate.id === profileId);
      if (!profile) {
        frag.appendText('No local profiles were detected for this browser.');
        return;
      }
      frag.appendText(
        `Bookmarks from ${profile.name}. The bookmark file is detected automatically.`,
      );
      frag.createEl('br');
      const access = checkSourceAccess(browser, profileId);
      if (!access.resolved) {
        frag.appendText(access.error ?? 'No bookmarks file was found for this profile.');
        return;
      }
      frag.appendText('Using: ');
      frag.createEl('code', { text: access.resolved });
      if (!access.exists) frag.appendText(' (not found)');
      else if (!access.accessible) frag.appendText(' (no permission)');
      else frag.appendText(' (found)');
    });
  }
}
