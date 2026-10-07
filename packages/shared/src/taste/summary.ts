import { DISH_TYPES, type DishType } from '../dishIndex.js';
import { makeTranslator } from '../i18n/index.js';
import type { Locale } from '../types.js';
import type { DerivedTaste } from './types.js';

const MAX_LINES = 6;

/**
 * The profile as at most six short lines in the customer's language. This exact text is shown on
 * the knows-me page and sent to the AI, so it never carries names, ids, digits or dates.
 */
export function summaryLines(derived: DerivedTaste, locale: Locale, typeOf: (branchId: string, productId: string) => DishType | undefined): string[] {
  const t = makeTranslator(locale);
  const sep = t('taste.listSep');
  const lines: string[] = [];
  if (derived.party) lines.push(t(`taste.summary.party.${derived.party}`));

  const disliked = DISH_TYPES.filter((d) => (derived.affinity[d] ?? 0) < 0);
  const liked: DishType[] = DISH_TYPES.filter((d) => (derived.affinity[d] ?? 0) > 0);
  for (const u of derived.usual) {
    const type = typeOf(u.branchId, u.productId);
    if (type && !liked.includes(type) && !disliked.includes(type)) liked.push(type);
  }
  if (liked.length) lines.push(t('taste.summary.likes', { list: liked.slice(0, 4).map((d) => t(`dishType.${d}`)).join(sep) }));
  if (disliked.length) lines.push(t('taste.summary.less', { list: disliked.slice(0, 4).map((d) => t(`dishType.${d}`)).join(sep) }));
  if (derived.daypart) lines.push(t(`taste.summary.daypart.${derived.daypart}`));
  if (derived.learnedOrders >= 3) lines.push(t('taste.summary.regular'));
  if (derived.learnedOrders === 0) lines.push(t('taste.summary.new'));
  return lines.slice(0, MAX_LINES);
}
