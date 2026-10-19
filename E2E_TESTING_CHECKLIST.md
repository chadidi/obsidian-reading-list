# Reading List - End-to-End (E2E) Test Checklist

This document provides a comprehensive end-to-end testing checklist for the **Obsidian Reading List** plugin across all supported browsers (**Google Chrome**, **Chromium**, **Apple Safari**, and **Mozilla Firefox**).

The plugin renders your reading list in a dashboard panel. It never writes items into your vault.

---

## 🛠️ Test Environment Setup & Preparation

Before beginning E2E testing:

- [ ] **Build & Deploy Latest Plugin Version:**
  ```bash
  npm run build
  ```
  Ensure `main.js`, `manifest.json`, and `styles.css` are in `<Your Vault>/.obsidian/plugins/reading-list/`.
- [ ] **Open Developer Tools in Obsidian:**
  - Press `Cmd + Option + I` (macOS) or `Ctrl + Shift + I` (Windows/Linux) to monitor console logs.
  - Filter console output by `[Reading List]`.
- [ ] **Enable Debug Logging in Settings:**
  - Go to **Settings → Community plugins → Reading List**.
  - Toggle on **Debug logging** to inspect detailed parsing and sync statistics.
- [ ] **Prepare Test Items in Each Browser:**
  - Ensure you have a mix of:
    - Items with plain URLs and URLs carrying query strings (e.g. `https://example.com/search?q=test&page=1`)
    - Titles with punctuation, wikilink chars, and emojis (e.g. `C# & [Rust] ^Guide: "Deep Dive" 🚀`)
    - Duplicate URLs (same link added twice) to verify de-duplication
    - At least one item with a preview excerpt, where the browser records one
    - Bookmarklets (e.g. `javascript:void(0)`) to verify rejection

---

## 🧭 Dashboard Panel

### 1. Opening the Dashboard
- [ ] **Ribbon Icon:**
  - Select the book icon in the left ribbon.
  - Verify the **Reading list** panel opens in the left sidebar, as a tab next to the core Bookmarks panel.
- [ ] **Command Palette:**
  - Run **Reading List: Open dashboard**.
  - Verify the panel opens (and that a second run reveals the existing panel instead of opening a duplicate).
- [ ] **Settings Button:**
  - Open **Settings → Community plugins → Reading List → Dashboard**.
  - Select **Open dashboard** and verify the panel opens.

### 2. Empty State
- [ ] **Before First Sync:**
  - With no items synced yet, verify the panel shows an empty-state message with a hint, not a broken list.

### 3. Toolbar
- [ ] **Search:**
  - Type part of a title; verify the list filters to matching items.
  - Type part of a URL; verify the list filters to matching items.
  - Clear the search; verify all items return.
- [ ] **Read Filter:**
  - Select **All items**, **Unread**, and **Read** in turn and verify the list matches.
  - For browsers that do not record a read state (Safari, Firefox), verify all items count as **Unread**.
- [ ] **Sort:**
  - Try **Newest first**, **Oldest first**, **Title A-Z**, and **Title Z-A** and verify ordering.
  - Verify items without a recorded date sort last.
- [ ] **Sync Button:**
  - Select **Sync** in the toolbar and verify a sync runs without leaving the panel.

### 4. Item Rendering & Interaction
- [ ] **Item Content:**
  - Verify each item shows its title, domain/source metadata, and excerpt where available.
- [ ] **Opening a Link:**
  - Select an item's title.
  - Verify the page opens as a **new tab in the main workspace** (Obsidian's Web Viewer), where notes normally open, not inside the sidebar and not in the external browser.
  - Select the open icon on the right of an item and verify it opens in your **default browser** instead.
  - If the core Web Viewer plugin is disabled, verify the title also falls back to your **default browser**.
- [ ] **Multiple Tabs:**
  - Open several items in a row and verify each opens in its own tab in the main workspace.
- [ ] **Live Refresh:**
  - With the dashboard open, run a sync (from the toolbar or the command palette).
  - Verify the list and the summary (item count, last sync time) update immediately.

---

## 🧭 Browser 1: Google Chrome

### 1. Default Location & Profile Detection
- [ ] **Platform Path Auto-Detection:**
  - Leave **Reading list file path** empty in settings.
  - Confirm the placeholder shows your OS default:
    - **macOS:** `~/Library/Application Support/Google/Chrome/Default/Reading List`
    - **Windows:** `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Reading List`
    - **Linux:** `~/.config/google-chrome/Default/Reading List`
  - Verify the description reports the detected path with **(found)**.
- [ ] **Default Profile Import:**
  - Run **Reading List: Sync now**.
  - Check console log for the Chrome parse count.
  - Verify the notice reads: `Reading list sync complete: N items, ...`.

### 2. Custom Profile Path (Optional)
- [ ] **Secondary Profile:**
  - Create or locate another Chrome profile (e.g., `Profile 1`).
  - Enter custom path: `~/Library/Application Support/Google/Chrome/Profile 1/Reading List` (or Windows/Linux equivalent).
  - Run **Sync now** and verify items from Profile 1 appear in the dashboard.
  - Select the reset (rotate) button and verify the path reverts to the detected default.

### 3. Read State & Validation
- [ ] **Read State Imported:**
  - Mark an item as read in Chrome's reading list.
  - Run **Sync now**.
  - Set the dashboard **Read filter** to **Read** and verify the item appears there.
- [ ] **Bookmarklet Ignored:**
  - Verify `javascript:` bookmarks are skipped and never appear in the dashboard.
- [ ] **Concurrent Usage:**
  - Keep Chrome actively open and browse while triggering sync in Obsidian.
  - Confirm sync succeeds without file lock conflicts.

---

## 🧭 Browser 2: Chromium (Brave, Edge, etc.)

- [ ] **Default Profile Detection:**
  - Select **Browser** → **Chromium (Brave, Edge...)**.
  - Verify the detected default path resolves and is readable.
- [ ] **Custom Chromium Path:**
  - Point the path at another Chromium-based browser's `Reading List` file.
  - Run **Sync now** and verify those items appear.
- [ ] **Read State Imported:**
  - Verify the read state is imported the same way it is for Chrome.

---

## 🧭 Browser 3: Apple Safari (macOS)

Safari stores bookmarks and its Reading List in `~/Library/Safari/Bookmarks.plist`, which macOS protects with System Integrity Protection (SIP) / TCC.

### 1. Permission & Access
- [ ] **Permission Denied Test (Without Access):**
  - If Obsidian does not yet have access, select **Safari**.
  - Verify a clear, actionable path description appears explaining how to grant access, and that the sync/automation settings stay hidden until then.
- [ ] **Grant Access via the File Picker (no Full Disk Access):**
  - Select **Choose Bookmarks.plist**.
  - Pick `~/Library/Safari/Bookmarks.plist` in the native dialog.
  - Verify the description confirms the file is being used for this session.
  - Verify the dashboard then renders the Safari reading list.
- [ ] **Grant Access via Full Disk Access (alternative):**
  - Open **macOS System Settings → Privacy & Security → Full Disk Access**.
  - Enable **Obsidian**, restart Obsidian, and verify sync succeeds without the picker.

### 2. Reading List Mapping
- [ ] **Only Reading List Items Imported:**
  - Add test pages to Safari's **Reading List** (`Shift + Cmd + D`).
  - Run **Sync now**.
  - Verify only reading-list items appear in the dashboard, and regular bookmarks/favorites do **not**.
- [ ] **Excerpt Shown:**
  - Verify Safari article previews appear as the item excerpt where Safari records one.
- [ ] **No Read State / No Date:**
  - Verify Safari items count as unread and that the date column falls back gracefully when Safari provides no creation date.

---

## 🧭 Browser 4: Mozilla Firefox

Firefox has no native reading list, so the plugin imports bookmarks from a folder you name. It supports two ingestion strategies: the live `places.sqlite` database and JSON/jsonlz4 backup archives.

### 0. Folders
- [ ] **Named Folder Import:**
  - Set **Firefox bookmarks folder** to a folder that exists in Firefox (e.g. `Reading list`).
  - Verify matching is case-insensitive and that nested folders can be targeted with `/`.
  - Verify clearing the field imports nothing from Firefox.

### Mode A: Live Database (`places.sqlite`)
- [ ] **Automatic Profile Detection:**
  - Leave **Firefox path** empty in settings.
  - Verify the plugin automatically finds the most active profile (prefers `*.default-release`).
- [ ] **Built-in SQLite Check:**
  - No external tool is required: `places.sqlite` is read with the SQLite module built into Obsidian.
  - Run **Sync now** and confirm items are extracted.
- [ ] **WAL Mode & Concurrent Browser Snapshot:**
  - Launch Firefox and add a new bookmark inside the target folder.
  - Do NOT close Firefox (`places.sqlite` is actively open with `places.sqlite-wal`).
  - Run **Sync now** and verify the newly added bookmark is captured.
- [ ] **Tag & Smart-Folder Exclusion:**
  - Verify tag virtual folders (`tags________`) and smart query folders (`place:sort=...`) are excluded.

### Mode B: Backup Archives (`*.jsonlz4` / `.json`)
- [ ] **Backup Folder Auto-Detection:**
  - Set **Firefox path** to your Firefox profile directory or its `bookmarkbackups` subfolder.
  - Run **Sync now** and verify the plugin locates the newest `bookmarks-YYYY-MM-DD_*.jsonlz4` and decompresses it.
- [ ] **Direct JSON Backup:**
  - In Firefox, export bookmarks manually (**Bookmarks → Manage Bookmarks → Import and Backup → Backup…**).
  - Set the path in settings to the exported file/directory and verify items import.

### Mode C: Missing Built-in SQLite (older Obsidian builds)
- [ ] Point **Firefox path** at a `bookmarkbackups/*.jsonlz4` file or folder.
- [ ] Run sync and verify it succeeds without the `places.sqlite` reader.

---

## ⚙️ Core Plugin Features E2E Verification

### 1. One-way List Semantics
- [ ] **New Items Appear:**
  - Add an item in the browser, run **Sync now**, verify it appears in the dashboard.
- [ ] **Removed Items Drop:**
  - Remove an item in the browser, run **Sync now**, verify it disappears from the dashboard.
- [ ] **No Vault Writes:**
  - Confirm no new notes or files are created anywhere in the vault by any sync.
  - Confirm notes created by an earlier version of the plugin are left untouched.

### 2. Duplicate Handling
- [ ] **De-duplication:**
  - Add the same URL twice in the browser.
  - Run **Sync now** and verify only one item appears, and that the notice reports the duplicate count.

### 3. Persistence
- [ ] **Survives Restart:**
  - Run a sync, then reload Obsidian (`Cmd + R` / `Ctrl + R`).
  - Verify the dashboard still shows the same items without re-syncing.

### 4. Automated Sync
- [ ] **Sync on Startup:**
  - Ensure **Sync on startup** is enabled and at least one manual sync has run.
  - Reload Obsidian and verify an automatic sync occurs shortly after load.
- [ ] **Interval Sync:**
  - Set **Sync interval (minutes)** to `1`.
  - Add a new item in your browser.
  - Wait 1 minute and verify the dashboard updates automatically without a manual command.
  - Reset the interval to `0` (manual only) after testing.
- [ ] **First-Run Guard:**
  - With a fresh install (before any manual sync), verify automatic syncs do **not** run until one manual sync completes.

### 5. Error Handling
- [ ] **Unreadable Source:**
  - Point the path at a missing file and run **Sync now**.
  - Verify a clear, non-repeating error notice appears and the panel keeps showing the last known list.

---

## 📋 Test Execution Sign-Off Matrix

| Browser | OS Platform | Mode / Feature | Status (Pass/Fail) | Date Tested | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **All** | All | Dashboard opens / empty state | ⬜ | | |
| **All** | All | Search / filter / sort | ⬜ | | |
| **All** | All | Open item: Web Viewer tab + default browser | ⬜ | | |
| **Google Chrome** | macOS / Win / Linux | Default path sync | ⬜ | | |
| **Google Chrome** | macOS / Win / Linux | Read state imported | ⬜ | | |
| **Google Chrome** | macOS / Win / Linux | Special characters | ⬜ | | |
| **Chromium** | macOS / Win / Linux | Default + custom path | ⬜ | | |
| **Apple Safari** | macOS | Permission warning | ⬜ | | |
| **Apple Safari** | macOS | File picker / Full Disk Access | ⬜ | | |
| **Apple Safari** | macOS | Reading List only (no bookmarks) | ⬜ | | |
| **Mozilla Firefox** | macOS / Win / Linux | Named folder import | ⬜ | | |
| **Mozilla Firefox** | macOS / Win / Linux | `places.sqlite` (live) | ⬜ | | |
| **Mozilla Firefox** | macOS / Win / Linux | WAL live snapshot | ⬜ | | |
| **Mozilla Firefox** | macOS / Win / Linux | `*.jsonlz4` backup | ⬜ | | |
| **All** | All | One-way semantics / no vault writes | ⬜ | | |
| **All** | All | Duplicate de-duplication | ⬜ | | |
| **All** | All | Persistence across restart | ⬜ | | |
| **All** | All | Interval sync / startup sync | ⬜ | | |
