import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, DEFAULT_SETTINGS, MAX_INTERVAL_MINUTES } from '../src/settings';

test('normalizeSettings returns defaults when given undefined or empty object', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
});

test('normalizeSettings clamps intervalMinutes to [0, max]', () => {
  assert.equal(normalizeSettings({ intervalMinutes: -10 }).intervalMinutes, 0);
  assert.equal(
    normalizeSettings({ intervalMinutes: 999999 }).intervalMinutes,
    MAX_INTERVAL_MINUTES,
  );
  assert.equal(normalizeSettings({ intervalMinutes: 30.7 }).intervalMinutes, 30);
});

test('normalizeSettings validates browser', () => {
  assert.equal(normalizeSettings({ browser: 'internet-explorer' as never }).browser, 'chrome');
  assert.equal(normalizeSettings({ browser: 'firefox' }).browser, 'firefox');
});

test('normalizeSettings keeps the firefox folder', () => {
  assert.equal(normalizeSettings({}).firefoxFolder, DEFAULT_SETTINGS.firefoxFolder);
  assert.equal(normalizeSettings({ firefoxFolder: 'Saved' }).firefoxFolder, 'Saved');
  assert.equal(
    normalizeSettings({ firefoxFolder: 7 as unknown as string }).firefoxFolder,
    DEFAULT_SETTINGS.firefoxFolder,
  );
});

test('normalizeSettings keeps booleans and coerces stray values', () => {
  assert.equal(normalizeSettings({}).syncOnStartup, true);
  assert.equal(normalizeSettings({ syncOnStartup: false }).syncOnStartup, false);
  assert.equal(
    normalizeSettings({ syncOnStartup: 'no' as unknown as boolean }).syncOnStartup,
    true,
  );

  assert.equal(normalizeSettings({}).debug, false);
  assert.equal(normalizeSettings({ debug: true }).debug, true);
  assert.equal(normalizeSettings({ initialSyncDone: undefined }).initialSyncDone, false);
  assert.equal(normalizeSettings({ initialSyncDone: true }).initialSyncDone, true);
});

test('normalizeSettings drops fields from older note-writing versions', () => {
  const legacy = normalizeSettings({
    targetFolder: 'ReadLater',
    allowVaultRootTarget: true,
    templateName: 'full',
    customTemplate: '# {{title}}',
  } as never);
  assert.deepEqual(legacy, DEFAULT_SETTINGS);
});
