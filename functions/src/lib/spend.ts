import { DEFAULT_AI_CAP_MICRO_USD, TRANSLATE_FREE_CHARS, TRANSLATE_MICRO_USD_PER_CHAR, israelDay, israelHour, type AiOutcome, type PlatformConfig, type SpendDay } from '@qareeb/shared';
import { FieldValue, col, db, nowIso } from './firebase.js';
import { aiPrice } from './prices.js';

const FAST_MS = 3000;

/**
 * One wish's AI cost and outcome, added to today's spendDaily doc with increments only, so
 * concurrent calls never conflict and the admin costs page sees them at once.
 */
export async function recordAiSpend(r: { outcome: AiOutcome; model?: string; inTok?: number; outTok?: number; ms?: number }, now = new Date()): Promise<void> {
  const inTok = r.inTok ?? 0;
  const outTok = r.outTok ?? 0;
  const price = r.model ? aiPrice(r.model) : { input: 0, output: 0 };
  const inMicro = Math.round(inTok * price.input);
  const outMicro = Math.round(outTok * price.output);
  const total = inMicro + outMicro;
  const inc = FieldValue.increment;
  const fallback = r.outcome === 'timeout' || r.outcome === 'invalid' || r.outcome === 'error' || r.outcome === 'capped' ? { fallback: { [r.outcome]: inc(1) } } : {};
  const called = r.model && r.outcome !== 'capped' && r.outcome !== 'skipped';
  await col.spendDaily(israelDay(now)).set(
    {
      ai: {
        microUsd: inc(total),
        calls: inc(1),
        ...(r.outcome === 'ok' ? { ok: inc(1) } : {}),
        ...(r.outcome === 'skipped' ? { skipped: inc(1) } : {}),
        ...fallback,
        inTok: inc(inTok),
        outTok: inc(outTok),
        inMicroUsd: inc(inMicro),
        outMicroUsd: inc(outMicro),
        ...(called && (r.ms ?? Infinity) <= FAST_MS ? { fast: inc(1) } : {}),
        ...(called ? { byModel: { [r.model!]: { microUsd: inc(total), calls: inc(1) } } } : {}),
      },
      ...(total > 0 ? { byHour: { [israelHour(now)]: { aiIn: inc(inMicro), aiOut: inc(outMicro) } } } : {}),
      updatedAt: nowIso(),
    },
    { merge: true },
  );
}

/**
 * Characters sent to Cloud Translation. Only characters past the month's free allowance cost money,
 * so the month's running total decides what this batch adds.
 */
export async function recordTranslateSpend(chars: number, now = new Date()): Promise<void> {
  if (chars <= 0) return;
  const day = israelDay(now);
  const monthRef = col.spendMonthly(day.slice(0, 7));
  await db.runTransaction(async (tx) => {
    const before = ((await tx.get(monthRef)).data()?.translateChars as number | undefined) ?? 0;
    const after = before + chars;
    const billable = Math.max(0, after - TRANSLATE_FREE_CHARS) - Math.max(0, before - TRANSLATE_FREE_CHARS);
    const micro = billable * TRANSLATE_MICRO_USD_PER_CHAR;
    const inc = FieldValue.increment;
    tx.set(monthRef, { translateChars: inc(chars), updatedAt: nowIso() }, { merge: true });
    tx.set(
      col.spendDaily(day),
      {
        translate: { microUsd: inc(micro), chars: inc(chars), jobs: inc(1) },
        ...(micro > 0 ? { byHour: { [israelHour(now)]: { translate: inc(micro) } } } : {}),
        updatedAt: nowIso(),
      },
      { merge: true },
    );
  });
}

/** The admin-set daily AI cap in micro-USD ($2 by default). */
export async function aiCapMicroUsd(): Promise<number> {
  const cfg = (await col.config().get()).data() as PlatformConfig | undefined;
  return typeof cfg?.aiDailyCapMicroUsd === 'number' ? cfg.aiDailyCapMicroUsd : DEFAULT_AI_CAP_MICRO_USD;
}

/** True once today's AI spend reaches the cap: wishes are then answered by code only. */
export async function aiCapReached(now = new Date()): Promise<boolean> {
  const [cap, today] = await Promise.all([aiCapMicroUsd(), col.spendDaily(israelDay(now)).get()]);
  const spent = (today.data() as SpendDay | undefined)?.ai?.microUsd ?? 0;
  return spent >= cap;
}
