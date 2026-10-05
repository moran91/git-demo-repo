/** Turns a stored card back into what the UI shows. A card whose dish, deal or place is gone resolves to null and is simply not shown. */
import type { DealsIndexCombo } from '../dishIndex.js';
import type { Localized } from '../types.js';
import { dishKey, type AssistantData, type AssistantDeal, type AssistantDish, type AssistantPlace } from './data.js';
import type { MealBasket, MealLine } from './mealBuilder.js';
import type { Usual } from './profile.js';
import type { Card } from './respond.js';

export type ResolvedCard =
  /** `inDeal`: the dish is in a live promotion, so the card shows the deal label. */
  | { kind: 'dish'; dish: AssistantDish; place: AssistantPlace; inDeal: boolean }
  | { kind: 'meal'; basket: MealBasket; place: AssistantPlace; lines: Array<{ line: MealLine; name: Localized; imagePath?: string }> }
  | { kind: 'deal'; deal: AssistantDeal; place: AssistantPlace; itemNames: Localized[] }
  | { kind: 'usual'; usual: Usual; place: AssistantPlace; missing: Localized[] };

export function resolveCard(card: Card, data: AssistantData): ResolvedCard | null {
  switch (card.kind) {
    case 'dish': {
      const dish = data.dishById.get(dishKey(card.branchId, card.productId));
      const place = data.places.get(card.branchId);
      return dish && place ? { kind: 'dish', dish, place, inDeal: data.promoted.has(dishKey(card.branchId, card.productId)) } : null;
    }
    case 'meal': {
      const place = data.places.get(card.basket.branchId);
      if (!place) return null;
      const lines: Array<{ line: MealLine; name: Localized; imagePath?: string }> = [];
      for (const line of card.basket.lines) {
        if (line.comboId) {
          const combo = wholeCombo(data, place.branchId, line.comboId);
          if (!combo) return null;
          lines.push({ line, name: combo.name, ...(combo.imagePath ? { imagePath: combo.imagePath } : {}) });
        } else {
          const d = data.dishById.get(dishKey(place.branchId, line.productId));
          if (!d) return null;
          lines.push({ line, name: d.entry.name, ...(d.entry.imagePath ? { imagePath: d.entry.imagePath } : {}) });
        }
      }
      return { kind: 'meal', basket: card.basket, place, lines };
    }
    case 'deal': {
      const deal = data.deals.find((d) => d.branchId === card.branchId && d.id === card.dealId);
      const place = data.places.get(card.branchId);
      if (!deal || !place) return null;
      if (deal.combo && !wholeCombo(data, place.branchId, deal.id)) return null;
      const ids = deal.combo ? deal.combo.items.map((i) => i.productId) : deal.promotion?.productIds ?? [];
      const itemNames = ids.map((id) => data.dishById.get(dishKey(place.branchId, id))?.entry.name).filter((n): n is Localized => !!n);
      // A promotion stays while any of its dishes is still on the menu.
      return itemNames.length ? { kind: 'deal', deal, place, itemNames } : null;
    }
    case 'usual': {
      const place = data.places.get(card.usual.branchId);
      if (!place) return null;
      const missing = card.usual.lines.filter((l) => (l.comboId ? !wholeCombo(data, place.branchId, l.comboId) : !data.dishById.has(dishKey(place.branchId, l.productId)))).map((l) => l.name);
      return { kind: 'usual', usual: card.usual, place, missing };
    }
  }
}

/** A combo whose every member is still on the menu; one gone dish and the combo cannot be ordered. */
function wholeCombo(data: AssistantData, branchId: string, comboId: string): DealsIndexCombo | undefined {
  const combo = data.deals.find((d) => d.branchId === branchId && d.id === comboId)?.combo;
  return combo && combo.items.every((i) => data.dishById.has(dishKey(branchId, i.productId))) ? combo : undefined;
}
