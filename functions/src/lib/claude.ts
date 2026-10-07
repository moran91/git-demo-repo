import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';

/** One structured call: the system rules, the user message, and the JSON schema the answer must follow. */
export interface MealPickRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  signal: AbortSignal;
}
export interface MealPickResult {
  json: unknown;
  inTok: number;
  outTok: number;
}
export interface MealPicker {
  model: string;
  pick(req: MealPickRequest): Promise<MealPickResult>;
}

export const DEFAULT_AI_MODEL = 'claude-haiku-4-5@20251001';
export const MAX_OUT_TOKENS = 500;

let client: AnthropicVertex | null = null;

/**
 * Claude on Google Cloud Vertex AI in this project, through the functions' service account (ADC):
 * no API key, billed on the project's Google Cloud bill. Global endpoint, standard price.
 */
function vertexPicker(model: string): MealPicker {
  return {
    model,
    async pick({ system, user, schema, signal }) {
      client ??= new AnthropicVertex({ region: process.env.AI_REGION || 'global', projectId: process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? null });
      const res = await client.messages.create(
        { model, max_tokens: MAX_OUT_TOKENS, system, messages: [{ role: 'user', content: user }], output_config: { format: { type: 'json_schema', schema } } },
        { signal, maxRetries: 0 },
      );
      const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return { json, inTok: res.usage.input_tokens, outTok: res.usage.output_tokens };
    },
  };
}

/**
 * The emulator never calls Google. The stub answers with the first candidate of the first two
 * places, sized for the party, and a marker in the wish makes it misbehave for tests:
 * [stub:slow] waits past the timeout, [stub:malformed] returns junk, [stub:wrong] names an unknown
 * dish, [stub:error] throws.
 */
const stubPicker: MealPicker = {
  model: 'stub',
  async pick({ system, user, signal }) {
    const inTok = Math.ceil((system.length + user.length) / 4);
    if (user.includes('[stub:slow]')) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 8000);
        signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
      });
    }
    if (user.includes('[stub:error]')) throw new Error('stub error');
    if (user.includes('[stub:malformed]')) return { json: { meals: 'nope' }, inTok, outTok: 10 };
    const party = Number(/^party: (\d+)$/m.exec(user)?.[1] ?? 1);
    const rows = [...user.matchAll(/^(c\d+) \| place (\d+) \| [^|]+ \| (\w+) \|/gm)].map((m) => ({ id: m[1]!, place: m[2]!, type: m[3]! }));
    const firstPerPlace = new Map<string, { id: string; type: string }>();
    const side = (type: string) => ['drinks', 'snacks', 'salads', 'pastries', 'desserts'].includes(type);
    for (const r of rows) if (!side(r.type) && !firstPerPlace.has(r.place)) firstPerPlace.set(r.place, r);
    const locale = /^locale: (\w+)$/m.exec(user)?.[1];
    const meals = [...firstPerPlace.values()].slice(0, 2).map((r, i) => ({
      title: locale === 'ar' ? 'وجبة لذيذة' : locale === 'en' ? 'A tasty meal' : 'ארוחה טעימה',
      reason: i === 0 ? 'fits_wish' : 'new_for_you',
      items: [{ id: user.includes('[stub:wrong]') ? 'c999' : r.id, qty: Math.max(1, Math.ceil(party / (r.type === 'pizza' ? 2 : 1))) }],
    }));
    const json = { meals, noFit: meals.length ? 'none' : 'closed' };
    return { json, inTok, outTok: Math.ceil(JSON.stringify(json).length / 4) };
  },
};

export function getMealPicker(): MealPicker {
  if (process.env.FUNCTIONS_EMULATOR === 'true') return stubPicker;
  return vertexPicker(process.env.AI_MODEL || DEFAULT_AI_MODEL);
}

/** AI_SUGGEST=1 in functions/.env switches the AI on; off, every wish is answered by code. */
export function aiEnabled(): boolean {
  // The emulator runs the stub unless a test switches it off.
  return process.env.AI_SUGGEST === '1' || (process.env.FUNCTIONS_EMULATOR === 'true' && process.env.AI_SUGGEST !== '0');
}
