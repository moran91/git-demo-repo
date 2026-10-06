/**
 * Taste profile: what Qareeb has learned about one customer. Stored at users/{uid}/taste/profile
 * (server-written) or in localStorage as qareeb.taste.v1 while signed out. See
 * docs/superpowers/specs/2026-10-06-taste-profile-design.md.
 */
import type { DishType } from '../dishIndex.js';
import type { Locale } from '../types.js';

export const PARTIES = ['solo', 'two', 'family', 'friends'] as const;
export type Party = (typeof PARTIES)[number];
/** 06–11, 11–16, 16–22, 22–06 in Asia/Jerusalem. */
export const DAYPARTS = ['morning', 'noon', 'evening', 'late'] as const;
export type Daypart = (typeof DAYPARTS)[number];
export const PAIR_ANSWERS = ['a', 'b', 'neither', 'both'] as const;
export type PairAnswer = (typeof PAIR_ANSWERS)[number];
export type DishVerdict = 'loved' | 'not_again';
/** Bumped whenever the consent sheet's wording changes. */
export const TASTE_CONSENT_VERSION = 1;

export interface TasteConsent {
  /** Tier 1: learn from my orders and ratings (default on, with notice). */
  orders: boolean;
  /** Tier 2: taste game and profile building (opt-in). */
  learn: boolean;
  /** Tier 2: send my taste summary to the AI to answer wishes (opt-in). */
  ai: boolean;
  version: number;
  locale: Locale;
  at: string;
}

export interface TastePair { a: DishType; b: DishType; answer: PairAnswer }

export interface TasteQuiz {
  party: Party | null;
  pairs: TastePair[];
  at: string;
}

export interface TasteDoc {
  v: 1;
  /** null = never asked. */
  consent: TasteConsent | null;
  quiz: TasteQuiz | null;
  /** Knows-item keys the customer removed. */
  suppressed: string[];
  /** Set by "delete everything": older orders no longer teach. */
  ignoreOrdersBefore: string | null;
  lastAiSummary: { text: string; at: string } | null;
  updatedAt: string;
}

/** users/{uid}/dishFeedback/{orderId} */
export interface DishFeedback {
  orderId: string;
  branchId: string;
  placedAt: string;
  /** productId → verdict. */
  items: Record<string, DishVerdict>;
  /** true: this order teaches nothing. */
  forSomeoneElse: boolean;
  /** The card was closed without answers. */
  dismissed: boolean;
  updatedAt: string;
}

export type KnowsItem =
  | { key: 'party'; source: 'told'; party: Party }
  | { key: `type:${DishType}`; source: 'told'; dishType: DishType }
  | { key: `usual:${string}`; source: 'orders'; branchId: string; productId: string }
  | { key: `daypart:${Daypart}`; source: 'orders'; daypart: Daypart }
  | { key: `loved:${string}`; source: 'rated'; branchId: string; productId: string }
  | { key: `notAgain:${string}`; source: 'rated'; branchId: string; productId: string };

export type ReasonCode = 'usual' | 'ordered_before' | 'you_picked' | 'popular_now' | 'new_for_you' | 'fits_wish';

export interface UsualDish { branchId: string; productId: string; score: number }

export interface DerivedTaste {
  items: KnowsItem[];
  /** Quiz-based type affinity, already multiplied by the quiz weight. Missing types are 0. */
  affinity: Partial<Record<DishType, number>>;
  usual: UsualDish[];
  /** dishKey of every dish in a learned order. */
  orderedBefore: string[];
  loved: string[];
  notAgain: string[];
  daypart: Daypart | null;
  party: Party | null;
  /** Accepted orders that count toward learning. */
  learnedOrders: number;
}

export interface PopularRef { branchId: string; productId: string }
export type PopularDayparts = Record<Daypart, PopularRef[]>;
/** publicPopular/{cityId}: ranks only, never counts. */
export interface PublicPopular { cityId: string; dayparts: PopularDayparts; updatedAt: string }

export function dishKey(branchId: string, productId: string): string {
  return `${branchId}/${productId}`;
}

export function splitDishKey(key: string): [string, string] {
  const i = key.indexOf('/');
  return [key.slice(0, i), key.slice(i + 1)];
}

export function emptyTasteDoc(now: string): TasteDoc {
  return { v: 1, consent: null, quiz: null, suppressed: [], ignoreOrdersBefore: null, lastAiSummary: null, updatedAt: now };
}
