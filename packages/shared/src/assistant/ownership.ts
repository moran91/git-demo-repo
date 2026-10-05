/**
 * Who owns a dish's tags, serves and type: the machine (autoTags) or the owner. A key in `autoFields`
 * means the stored value is still the automatic suggestion and may be re-derived; an owner who saves a
 * different value removes the key, and from then on nothing automatic touches that field again.
 *
 * "Machine-owned and empty" is a mark too: `tags: []` for no tags, and `dishType: 'none'` for no type
 * (the product itself then has no dishType). Serves always has a suggestion, so it is never empty.
 */
import type { DishType } from '../dishIndex.js';
import type { AutoTagResult, DishTag } from './tags.js';

/**
 * The marks: a key present means "this stored value is still the machine's".
 * Contract: once a product has been through resolveAutoFields it always has `serves`, so a product with
 * `serves` but no `autoFields` is an owner who owns every field (empty marks may be omitted when stored);
 * only a product with neither is legacy. Writers may therefore omit an empty `autoFields`, but must always store `serves`.
 */
export interface AutoFields {
  tags?: DishTag[];
  serves?: number;
  dishType?: DishType | 'none';
}
/** The values as stored on the product (an empty type is simply absent). */
export interface AutoValues {
  tags?: DishTag[];
  serves?: number;
  dishType?: DishType;
}
export type AutoKey = keyof AutoFields;
export type Ownable = AutoValues & { autoFields?: AutoFields };
export interface AutoInput {
  tags?: DishTag[];
  serves?: number;
  dishType?: DishType | 'none';
}

const KEYS: AutoKey[] = ['tags', 'serves', 'dishType'];

/** Order-insensitive equality for tag lists, plain equality for numbers and types. */
export const same = (a: unknown, b: unknown) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...b].sort() : b);

/** Empty compares as empty: an absent type is 'none', absent tags are []. */
const norm = (k: AutoKey, v: unknown) => (k === 'dishType' ? (v ?? 'none') : k === 'tags' ? (v ?? []) : v);

export function isMachineOwned(p: Ownable, key: AutoKey): boolean {
  // Legacy = never saved through resolveAutoFields (which always stores serves): empty fields are the machine's.
  if (!p.autoFields && p.serves === undefined) return p[key] === undefined;
  const mark = p.autoFields?.[key];
  return mark !== undefined && same(norm(key, p[key]), norm(key, mark));
}

/**
 * Decides each field's value and mark when a product is saved. `existing` is the stored product (undefined for a new one).
 * Omitted (undefined) input keeps owner-owned values and re-derives machine-owned ones from `suggested`; a sent value
 * becomes the owner's unless it equals the suggestion. The caller always stores `values` (it always includes `serves`)
 * and may omit an empty `autoFields`: `serves` without `autoFields` reads as "owner owns everything", never as legacy.
 */
export function resolveAutoFields(input: AutoInput, existing: Ownable | undefined, suggested: AutoTagResult): { values: AutoValues; autoFields: AutoFields } {
  const values: Record<string, unknown> = {};
  const autoFields: Record<string, unknown> = {};
  for (const k of KEYS) {
    const sentRaw = input[k];
    let value: unknown; // undefined = empty
    let machine: boolean;
    if (sentRaw === undefined) {
      if (!existing || isMachineOwned(existing, k)) {
        value = suggested[k];
        machine = true;
      } else {
        value = existing[k];
        machine = false;
      }
    } else {
      value = sentRaw === 'none' ? undefined : sentRaw;
      machine = same(norm(k, value), norm(k, suggested[k]));
    }
    if (value !== undefined) values[k] = value;
    if (machine) autoFields[k] = value === undefined ? 'none' : value;
  }
  return { values: values as AutoValues, autoFields: autoFields as AutoFields };
}
