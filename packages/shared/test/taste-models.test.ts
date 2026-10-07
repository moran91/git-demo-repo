import { describe, expect, it } from 'vitest';
import { AI_MODELS, aiModelLabel, resolveAiModel } from '../src/taste/index.js';

describe('AI models', () => {
  it('uses the admin choice when it is a known model, else the server default', () => {
    expect(resolveAiModel('claude-haiku-4-5@20251001', 'gemini-2.5-flash')).toBe('claude-haiku-4-5@20251001');
    expect(resolveAiModel(undefined, 'gemini-2.5-flash')).toBe('gemini-2.5-flash');
    expect(resolveAiModel('gpt-5', 'gemini-2.5-flash')).toBe('gemini-2.5-flash');
  });

  it('every model has a name and a price', () => {
    for (const m of AI_MODELS) {
      expect(m.label.length).toBeGreaterThan(3);
      expect(m.inputUsdPerM).toBeGreaterThan(0);
      expect(m.outputUsdPerM).toBeGreaterThan(m.inputUsdPerM);
    }
    expect(aiModelLabel('gemini-2.5-flash')).toBe('Gemini 2.5 Flash');
    expect(aiModelLabel('mystery')).toBe('mystery');
  });
});
