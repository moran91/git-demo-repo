/**
 * Single editable brand configuration. "Qareeb" is a working brand name, not a claim of trademark
 * or domain availability. Change it here; all UI, receipts, manifest and emails read from it.
 */
export const BRAND = {
  /** Lowercase wordmark as rendered in the header. */
  wordmark: 'qareeb',
  /** Proper name used in sentences/emails. */
  name: 'Qareeb',
  /** Used for the PWA manifest short name. */
  shortName: 'Qareeb',
  /** Theme colours (must match design tokens in apps/web/src/design/tokens.css). */
  themeColor: '#20583B',
  backgroundColor: '#FAF7F0',
} as const;
