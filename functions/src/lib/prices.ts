/**
 * Price per token in micro-USD (USD per million tokens = micro-USD per token), keyed by the model id
 * the AI client sends. Vertex AI global endpoint, standard price. Update with every model change.
 */
export const AI_PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5@20251001': { input: 1, output: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  // Gemini on Vertex, global endpoint (thinking tokens are billed as output). 3 Flash at its price
  // until 31 Dec 2026 (then $1.50 / $7.50: update this table).
  'gemini-3-flash-preview': { input: 0.75, output: 3.75 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  // The emulator stub costs what Haiku would, so the costs page shows realistic numbers in tests.
  'stub': { input: 1, output: 5 },
};

/** Unknown models are charged at the most expensive known price, so a cap never under-counts. */
export function aiPrice(model: string): { input: number; output: number } {
  return AI_PRICES[model] ?? Object.values(AI_PRICES).reduce((a, b) => (b.output > a.output ? b : a));
}
