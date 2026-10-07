/**
 * The AI models an admin can pick for wishes (config/platform.aiModel), all on Vertex AI in this
 * project. Prices are USD per million tokens at the global endpoint; the spend ledger and the costs
 * page use them, so update them with Google's price list.
 */
export const AI_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', inputUsdPerM: 0.3, outputUsdPerM: 2.5 },
  // Its price until 31 Dec 2026; then $1.50 / $7.50.
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (preview)', inputUsdPerM: 0.75, outputUsdPerM: 3.75 },
  { id: 'claude-haiku-4-5@20251001', label: 'Claude Haiku 4.5', inputUsdPerM: 1, outputUsdPerM: 5 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', inputUsdPerM: 2, outputUsdPerM: 10 },
] as const;

export type AiModelId = (typeof AI_MODELS)[number]['id'];
export const AI_MODEL_IDS = AI_MODELS.map((m) => m.id) as [AiModelId, ...AiModelId[]];

/** The model wishes use: the admin's choice when it is a known model, else the server default. */
export function resolveAiModel(configured: string | undefined, fallback: string): string {
  return configured && (AI_MODEL_IDS as readonly string[]).includes(configured) ? configured : fallback;
}

export function aiModelLabel(id: string): string {
  return AI_MODELS.find((m) => m.id === id)?.label ?? id;
}

/** Why a model test failed, in words the admin panel can explain. */
export type AiTestReason = 'quota' | 'permission' | 'not_found' | 'timeout' | 'invalid' | 'error';
export interface AiTestResult { ok: boolean; model: string; ms: number; reason?: AiTestReason; detail?: string; sample?: string }
