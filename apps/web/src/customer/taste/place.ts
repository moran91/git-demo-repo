import type { PublicBranch } from '../hooks';

type L = (value: Record<string, string> | undefined, fallback?: 'he' | 'ar' | 'en') => string;

/** A place's name for a card: the business, plus the branch when the city lists more than one of its branches. */
export function placeName(branch: PublicBranch, all: Iterable<PublicBranch>, L: L): string {
  const business = L(branch.businessName, branch.businessDefaultLocale);
  let siblings = 0;
  for (const b of all) if (b.businessId === branch.businessId) siblings++;
  const name = L(branch.name, branch.businessDefaultLocale);
  return siblings > 1 && name && name !== business ? `${business}, ${name}` : business;
}
