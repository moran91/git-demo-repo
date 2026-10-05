/** Turns a stored card back into what the UI shows. A card whose dish, deal or place is gone resolves to null and is simply not shown. */
import type { Localized } from '../types.js';
import { dishKey, type AssistantData, type AssistantDeal, type AssistantDish, type AssistantPlace } from './data.js';
import type { MealBasket, MealLine } from './mealBuilder.js';
import type { Usual } from './profile.js';
import type { Card } from './respond.js';

export type ResolvedCard =
  | { kind: 'dish'; dish: AssistantDish; place: AssistantPlace }
  | { kind: 'meal'; basket: MealBasket; place: AssistantPlace; lines: Array<{ line: MealLine; name: Localized; imagePath?: string }> }
  | { kind: 'deal'; deal: AssistantDeal; place: AssistantPlace; itemNames: Localized[] }
  | { kind: 'usual'; usual: Usual; place: AssistantPlace; missing: Localized[] };

export function resolveCard(card: Card, data: AssistantData): ResolvedCard | null {
  switch (card.kind) {
    case 'dish': {
      const dish = data.dishById.get(dishKey(card.branchId, card.productId));
      const place = data.places.get(card.branchId);
      return dish && place ? { kind: 'dish', dish, place } : null;
    }
    case 'meal': {
      const place = data.places.get(card.basket.branchId);
      if (!place) return null;
      const lines: Array<{ line: MealLine; name: Localized; imagePath?: string }> = [];
      for (const line of card.basket.lines) {
        if (line.comboId) {
          const combo = data.deals.find((d) => d.branchId === place.branchId && d.id === line.comboId)?.combo;
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
      const ids = deal.combo ? deal.combo.items.map((i) => i.productId) : deal.promotion?.productIds ?? [];
      return { kind: 'deal', deal, place, itemNames: ids.map((id) => data.dishById.get(dishKey(place.branchId, id))?.entry.name).filter((n): n is Localized => !!n) };
    }
    case 'usual': {
      const place = data.places.get(card.usual.branchId);
      if (!place) return null;
      const missing = card.usual.lines.filter((l) => (l.comboId ? !data.deals.some((d) => d.branchId === place.branchId && d.id === l.comboId) : !data.dishById.has(dishKey(place.branchId, l.productId)))).map((l) => l.name);
      return { kind: 'usual', usual: card.usual, place, missing };
    }
  }
}
