import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderTemplate,
  findUnknownPlaceholders,
  type TemplateContext,
  type DateFormatter,
} from '../src/template';

const dummyFormatter: DateFormatter = (date, format) => {
  const iso = date.toISOString();
  if (format === 'YYYY-MM-DD') return iso.slice(0, 10);
  if (format === 'HH:mm') return iso.slice(11, 16);
  return `${iso}_${format}`;
};

const baseCtx: TemplateContext = {
  title: 'My "Awesome" Article: A Deep Dive',
  url: 'https://www.example.com/posts/123?ref=feed',
  date: new Date('2024-03-15T10:30:00.000Z'),
  synced: new Date('2024-03-16T12:00:00.000Z'),
  excerpt: 'A short preview of the article.',
  read: false,
  browser: 'chrome',
};

test('renderTemplate replaces standard placeholders', () => {
  const template = `Title: {{title}}\nURL: {{url}}\nDate: {{date}}\nSynced: {{synced}}\nDomain: {{domain}}\nBrowser: {{browser}}\nExcerpt: {{excerpt}}\nRead: {{read}}`;
  const rendered = renderTemplate(template, baseCtx, dummyFormatter, 'YYYY-MM-DD');

  assert.match(rendered, /Title: My "Awesome" Article: A Deep Dive/);
  assert.match(rendered, /URL: https:\/\/www\.example\.com\/posts\/123\?ref=feed/);
  assert.match(rendered, /Date: 2024-03-15/);
  assert.match(rendered, /Synced: 2024-03-16/);
  assert.match(rendered, /Domain: example\.com/);
  assert.match(rendered, /Browser: Google Chrome/);
  assert.match(rendered, /Excerpt: A short preview of the article\./);
  assert.match(rendered, /Read: false/);
});

test('renderTemplate supports date formatting arguments', () => {
  const template = `Added: {{date:HH:mm}} | Synced: {{synced:HH:mm}}`;
  const rendered = renderTemplate(template, baseCtx, dummyFormatter, 'YYYY-MM-DD');

  assert.equal(rendered, 'Added: 10:30 | Synced: 12:00');
});

test('renderTemplate supports filters (yaml, lower, upper)', () => {
  const template = `YAML: {{title|yaml}}\nLower: {{browser|lower}}\nUpper: {{domain|upper}}`;
  const rendered = renderTemplate(template, baseCtx, dummyFormatter, 'YYYY-MM-DD');

  assert.equal(
    rendered,
    `YAML: ${JSON.stringify(baseCtx.title)}\nLower: google chrome\nUpper: EXAMPLE.COM`,
  );
});

test('renderTemplate slug filter normalizes a title', () => {
  const ctx: TemplateContext = { ...baseCtx, title: '  Music Stuff / Sax Songs  ' };
  const rendered = renderTemplate('Slug: {{title|slug}}', ctx, dummyFormatter, 'YYYY-MM-DD');

  assert.equal(rendered, 'Slug: music-stuff-sax-songs');
});

test('renderTemplate renders the read state, empty when the browser does not track it', () => {
  const template = 'read: {{read}}';
  assert.equal(
    renderTemplate(template, { ...baseCtx, read: true }, dummyFormatter, 'YYYY-MM-DD'),
    'read: true',
  );
  assert.equal(
    renderTemplate(template, { ...baseCtx, read: false }, dummyFormatter, 'YYYY-MM-DD'),
    'read: false',
  );
  assert.equal(
    renderTemplate(template, { ...baseCtx, read: null }, dummyFormatter, 'YYYY-MM-DD'),
    'read: ',
  );
});

test('renderTemplate leaves unknown placeholders intact', () => {
  const template = `{{title}} by {{author}} with {{tag|lower}}`;
  const rendered = renderTemplate(template, baseCtx, dummyFormatter, 'YYYY-MM-DD');

  assert.equal(rendered, `${baseCtx.title} by {{author}} with {{tag|lower}}`);
});

test('renderTemplate handles edge cases (empty excerpt, invalid url)', () => {
  const emptyCtx: TemplateContext = {
    ...baseCtx,
    url: 'not-a-valid-url',
    excerpt: '',
    read: null,
    browser: 'safari',
  };
  const template = `Domain: '{{domain}}' | Excerpt: '{{excerpt}}' | Read: '{{read}}' | Browser: {{browser}}`;
  const rendered = renderTemplate(template, emptyCtx, dummyFormatter, 'YYYY-MM-DD');

  assert.equal(rendered, "Domain: '' | Excerpt: '' | Read: '' | Browser: Safari");
});

test('findUnknownPlaceholders identifies invalid placeholders', () => {
  const valid = `---
title: {{title|yaml}}
url: {{url}}
date: {{date:YYYY-MM-DD}}
synced: {{synced}}
excerpt: {{excerpt|yaml}}
read: {{read}}
domain: {{domain}}
browser: {{browser}}
---`;
  assert.deepEqual(findUnknownPlaceholders(valid), []);

  const invalid = `Hello {{name}}! Read {{book:chapter|upper}} from {{source}} with {{title}}`;
  const unknowns = findUnknownPlaceholders(invalid);
  assert.deepEqual(unknowns.sort(), ['{{book}}', '{{name}}', '{{source}}']);
});
