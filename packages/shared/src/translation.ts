/**
 * Menu auto-translation rules (docs/superpowers/specs/2026-09-26-smart-search-design.md, part 2).
 * Pure functions shared by the save callables, the translation job and the backfill script.
 *
 * Every translatable document may carry `autoTranslated`: per text field (by path), the languages
 * that are machine-written and the source text they were made from. The owner's own text is never
 * listed there and is never overwritten.
 */
import { soundKey } from './search/soundKey.js';
import { LOCALES, type Locale, type Localized, type Product } from './types.js';

/** Machine-written language → the source text it was translated from. */
export type AutoMark = Partial<Record<Locale, string>>;
/** Field path ('name', 'variants/<id>/name', 'modifierGroups/<id>/options/<id>/name') → mark. */
export type AutoTranslated = Record<string, AutoMark>;
const machineLangs = (mark: AutoMark | undefined): Locale[] => Object.keys(mark ?? {}) as Locale[];

export type TranslatableKind = 'product' | 'category' | 'group';
export interface TextField { path: string; value: Localized }

type OptionLike = { id: string; name: Localized };
type GroupLike = { id: string; name: Localized; options: OptionLike[]; sharedGroupId?: string };
type Doc = { name: Localized; description?: Localized; variants?: OptionLike[]; modifierGroups?: GroupLike[]; options?: OptionLike[] };

/** Every customer-visible text of the document. Library copies inside a dish are translated at the library. */
export function textFields(kind: TranslatableKind, doc: Doc | Product): TextField[] {
  const d = doc as Doc;
  const out: TextField[] = [{ path: 'name', value: d.name ?? {} }];
  if (kind === 'product') {
    out.push({ path: 'description', value: d.description ?? {} });
    for (const v of d.variants ?? []) out.push({ path: `variants/${v.id}/name`, value: v.name });
    for (const g of d.modifierGroups ?? []) {
      if (g.sharedGroupId) continue;
      out.push({ path: `modifierGroups/${g.id}/name`, value: g.name });
      for (const o of g.options) out.push({ path: `modifierGroups/${g.id}/options/${o.id}/name`, value: o.name });
    }
  }
  if (kind === 'group') for (const o of d.options ?? []) out.push({ path: `options/${o.id}/name`, value: o.name });
  return out;
}

const filled = (s: string | undefined): s is string => !!s && s.trim().length > 0;

/** The language a field is translated from: the business default if written by a person, else he, ar, en. */
export function sourceOf(value: Localized, defaultLocale: Locale, machineLangs: Locale[] = []): { lang: Locale; text: string } | null {
  for (const lang of [defaultLocale, ...LOCALES.filter((l) => l !== defaultLocale)]) {
    const text = value[lang];
    if (filled(text) && !machineLangs.includes(lang)) return { lang, text };
  }
  return null;
}

export interface TranslationTarget { path: string; from: Locale; to: Locale; text: string }

/** What a translation job must translate: missing languages, and machine text whose source changed. */
export function translationTargets(fields: TextField[], auto: AutoTranslated, defaultLocale: Locale): TranslationTarget[] {
  const out: TranslationTarget[] = [];
  for (const f of fields) {
    const mark = auto[f.path];
    const src = sourceOf(f.value, defaultLocale, machineLangs(mark));
    if (!src) continue;
    for (const to of LOCALES) {
      if (to === src.lang) continue;
      const missing = !filled(f.value[to]);
      const stale = mark?.[to] !== undefined && mark[to] !== src.text;
      if (missing || stale) out.push({ path: f.path, from: src.lang, to, text: src.text });
    }
  }
  return out;
}

/**
 * The machine marks that survive an owner save: a language stays machine-written only while its
 * text is exactly what was stored; anything the owner typed or cleared is dropped from the mark.
 */
export function reconcileAuto(prevFields: TextField[], prevAuto: AutoTranslated, nextFields: TextField[]): AutoTranslated {
  const prev = new Map(prevFields.map((f) => [f.path, f.value]));
  const out: AutoTranslated = {};
  for (const f of nextFields) {
    const mark = prevAuto[f.path];
    const before = prev.get(f.path);
    if (!mark || !before) continue;
    const kept: AutoMark = {};
    for (const l of machineLangs(mark)) if (filled(f.value[l]) && f.value[l] === before[l]) kept[l] = mark[l];
    if (Object.keys(kept).length) out[f.path] = kept;
  }
  return out;
}

export interface TranslationResult { path: string; to: Locale; text: string; fromText: string }

/**
 * Writes translation results into a copy of the document. A result is skipped when the field's source
 * text changed after it was queued, or when the owner has written that language since.
 */
export function applyTranslations<T extends Doc | Product>(kind: TranslatableKind, doc: T, auto: AutoTranslated, defaultLocale: Locale, results: TranslationResult[]): { doc: T; auto: AutoTranslated; changed: boolean } {
  const next = structuredClone(doc) as T;
  const nextAuto: AutoTranslated = structuredClone(auto);
  let changed = false;
  const fields = new Map(textFields(kind, next).map((f) => [f.path, f.value]));
  for (const r of results) {
    const value = fields.get(r.path);
    if (!value) continue;
    const mark = nextAuto[r.path];
    const src = sourceOf(value, defaultLocale, machineLangs(mark));
    if (!src || src.text !== r.fromText) continue;
    const ownerWrote = filled(value[r.to]) && mark?.[r.to] === undefined;
    if (ownerWrote || !filled(r.text)) continue;
    value[r.to] = r.text.trim();
    nextAuto[r.path] = { ...mark, [r.to]: r.fromText };
    changed = true;
  }
  return { doc: next, auto: nextAuto, changed };
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Text prepared for an HTML-mode translation request: HTML-escaped, with every word that sounds like
 * the business's own name (מוראנו ~ מורנו) wrapped in translate="no" and replaced by the name in the
 * target language when the business has one.
 */
export function protectNames(text: string, businessName: Localized, to: Locale): string {
  const names = Object.values(businessName).map((n) => (n ?? '').trim()).filter(Boolean);
  const target = businessName[to]?.trim();
  const shield = (s: string) => `<span translate="no">${escapeHtml(s)}</span>`;
  // A multi-word name ("שווארמה אבו סלים") is protected only as the whole phrase: its single words
  // are ordinary food words that must still be translated.
  for (const phrase of names.filter((n) => /\s/.test(n))) {
    const at = text.indexOf(phrase);
    if (at >= 0) return escapeHtml(text.slice(0, at)) + shield(target || phrase) + escapeHtml(text.slice(at + phrase.length));
  }
  // A one-word name ("מורנו") also protects its other spellings (מוראנו) by sound.
  const keys = new Set(names.filter((n) => !/\s/.test(n)).map(soundKey).filter((k) => k.length >= 2));
  const oneWordTarget = target && !/\s/.test(target) ? target : undefined;
  return text.split(/(\s+)/).map((part) => {
    if (/^\s+$/.test(part) || !part) return part;
    if (keys.has(soundKey(part))) return shield(oneWordTarget || part);
    return escapeHtml(part);
  }).join('');
}

/** Reverses the HTML mode: drops the protective spans and decodes entities. */
export function fromTranslatedHtml(html: string): string {
  return html
    .replace(/<span translate="no">|<\/span>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
