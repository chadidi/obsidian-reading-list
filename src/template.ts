import { BROWSER_LABELS, type BrowserType } from './types';

export interface TemplateContext {
  title: string;
  url: string;
  /** When the item was added to the reading list (falls back to the sync time if unknown). */
  date: Date;
  /** When this sync ran. */
  synced: Date;
  /** Article preview text recorded by the browser (Safari), otherwise "". */
  excerpt: string;
  /** Read state when the browser tracks one (Chrome), otherwise null (unknown). */
  read: boolean | null;
  browser: BrowserType;
}

export type DateFormatter = (date: Date, format: string) => string;

export const PLACEHOLDERS = [
  'title',
  'url',
  'date',
  'excerpt',
  'read',
  'domain',
  'browser',
  'synced',
] as const;

/**
 * {{name}}  {{name:argument}}  {{name|filter}}  {{name:argument|filter}}
 * e.g. {{title|yaml}}  {{date:YYYY-MM-DD HH:mm}}
 */
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z_]+)(?::([^|}]*))?(?:\|\s*([A-Za-z]+))?\s*\}\}/g;

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

function applyFilter(value: string, filter: string | undefined): string {
  switch ((filter ?? '').toLowerCase()) {
    case 'yaml':
      // A JSON string is a valid YAML double-quoted scalar: safe for titles with ":" or quotes.
      return JSON.stringify(value);
    case 'lower':
      return value.toLowerCase();
    case 'upper':
      return value.toUpperCase();
    case 'slug':
      return slugify(value);
    default:
      return value;
  }
}

export function renderTemplate(
  template: string,
  ctx: TemplateContext,
  formatDate: DateFormatter,
  defaultDateFormat: string,
): string {
  return template.replace(
    PLACEHOLDER_RE,
    (match, rawName: string, arg: string | undefined, filter: string | undefined) => {
      let value: string;
      switch (rawName.toLowerCase()) {
        case 'title':
          value = ctx.title;
          break;
        case 'url':
          value = ctx.url;
          break;
        case 'date':
          value = formatDate(ctx.date, arg?.trim() || defaultDateFormat);
          break;
        case 'synced':
          value = formatDate(ctx.synced, arg?.trim() || defaultDateFormat);
          break;
        case 'excerpt':
          value = ctx.excerpt;
          break;
        case 'read':
          // A boolean is the most useful form for front matter; empty when the browser does not track it.
          value = ctx.read === null ? '' : ctx.read ? 'true' : 'false';
          break;
        case 'domain':
          value = domainOf(ctx.url);
          break;
        case 'browser':
          value = BROWSER_LABELS[ctx.browser];
          break;
        default:
          return match; // unknown placeholder: leave untouched so the mistake is visible
      }
      return applyFilter(value, filter);
    },
  );
}

export function findUnknownPlaceholders(template: string): string[] {
  const known = new Set<string>(PLACEHOLDERS);
  const unknown = new Set<string>();
  for (const m of template.matchAll(PLACEHOLDER_RE)) {
    const placeholder = m[1];
    if (placeholder && !known.has(placeholder.toLowerCase())) unknown.add(`{{${placeholder}}}`);
  }
  return [...unknown];
}
