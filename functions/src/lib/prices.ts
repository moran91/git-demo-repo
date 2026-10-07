/**
 * Price per token in micro-USD (USD per million tokens = micro-USD per token), keyed by the model id
 * the AI client sends. Vertex AI global endpoint, standard price. Update with every model change.
 */
export const AI_PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5@20251001': { input: 1, output: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  // The emulator stub costs what Haiku would, so the costs page shows realistic numbers in tests.
  'stub': { input: 1, output: 5 },
};

/** Unknown models are charged at the most expensive known price, so a cap never under-counts. */
export function aiPrice(model: string): { input: number; output: number } {
  return AI_PRICES[model] ?? Object.values(AI_PRICES).reduce((a, b) => (b.output > a.output ? b : a));
}
