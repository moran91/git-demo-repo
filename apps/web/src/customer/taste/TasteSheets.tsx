import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { DISH_TYPES, DISH_TYPE_WORDS, allWords, type BandDish, type DishType, type PairAnswer, type Party, type TastePair } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { call } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { Button, Dialog, toast } from '@/design/components';
import { Icon, type IconName } from '@/design/Icon';
import { LanguageSelect } from '@/app/Shell';
import { StorageImage } from '../StorageImage';
import { consentSeen, localTaste, tasteSession, useTaste } from './useTaste';
import './taste.css';

/**
 * Mounted on the home: the consent sheet once (first visit), and the taste game when asked for. The
 * game needs learn consent, so asking for it without consent shows the consent sheet first.
 */
export function TasteHost({ dishes }: { dishes: BandDish[] }) {
  const { user } = useAuth();
  const taste = useTaste();
  const session = tasteSession.use();
  const local = localTaste.use();
  const seen = consentSeen.use().seen;
  const mergePending = !!user && !!(local.doc?.consent || local.doc?.quiz);
  const firstVisit = !taste.loading && !mergePending && taste.doc?.consent == null && !session.consentShown && !seen;
  const wantsGame = session.gameOpen;
  const consentOpen = firstVisit || (wantsGame && taste.doc?.consent?.learn !== true && !taste.loading);
  const gameOpen = wantsGame && taste.doc?.consent?.learn === true;

  const answer = async (yes: boolean) => {
    consentSeen.set({ seen: true });
    tasteSession.set({ consentShown: true, gameOpen: yes && (wantsGame || firstVisit) });
    try {
      await taste.actions.setConsent({ orders: true, learn: yes, ai: yes });
    } catch (e) {
      tasteSession.set({ gameOpen: false });
      toast(t(errorKey(e)), 'danger');
    }
  };
  const t = useT();
  return (
    <>
      <ConsentSheet open={consentOpen} onYes={() => void answer(true)} onNo={() => void answer(false)} onClose={() => { consentSeen.set({ seen: true }); tasteSession.set({ consentShown: true, gameOpen: false }); }} />
      {gameOpen ? <TasteGame dishes={dishes} onClose={() => tasteSession.set({ gameOpen: false })} /> : null}
    </>
  );
}

/** Three plain lines and two equal buttons. Nothing is pre-ticked. */
export function ConsentSheet({ open, onYes, onNo, onClose }: { open: boolean; onYes: () => void; onNo: () => void; onClose: () => void }) {
  const t = useT();
  const lines: Array<[IconName, string]> = [['bag', t('taste.consent.orders')], ['heart', t('taste.consent.learn')], ['star', t('taste.consent.ai')]];
  return (
    <Dialog open={open} onClose={onClose} title={t('taste.consent.title')} headerEnd={<LanguageSelect />}>
      <div className="tconsent">
        <ul className="tconsent__lines">
          {lines.map(([icon, text]) => (
            <li key={icon}><span className="tconsent__icon"><Icon name={icon} size={16} /></span><span>{text}</span></li>
          ))}
        </ul>
        <div className="tconsent__actions">
          <Button onClick={onYes}>{t('taste.consent.yes')}</Button>
          <Button variant="secondary" onClick={onNo}>{t('taste.consent.no')}</Button>
        </div>
        <Link to="/account/taste" className="tconsent__more" onClick={onClose}>{t('taste.knows.title')}</Link>
      </div>
    </Dialog>
  );
}

const PARTY_ICONS: Record<Party, IconName> = { solo: 'user', two: 'heart', family: 'house', friends: 'users' };
const PARTIES: Party[] = ['solo', 'two', 'family', 'friends'];
const QUESTIONS = 4;

/** Q3 follows Q2's answer (burger vs pizza): the two biggest mains in Beit Jann first. */
function thirdPair(second: TastePair | undefined): [DishType, DishType] {
  if (!second) return ['shawarma', 'salads'];
  if (second.answer === 'a') return ['snacks', 'salads'];
  if (second.answer === 'b') return ['pasta', 'mains'];
  if (second.answer === 'neither') return ['sushi', 'hummus'];
  return ['shawarma', 'salads'];
}

/** Q4 pairs the type leading so far with one not shown yet. */
function fourthPair(pairs: TastePair[], available: Set<DishType>): [DishType, DishType] {
  const score = new Map<DishType, number>();
  for (const p of pairs) {
    const add = (d: DishType, v: number) => score.set(d, (score.get(d) ?? 0) + v);
    if (p.answer === 'a') add(p.a, 1);
    else if (p.answer === 'b') add(p.b, 1);
    else if (p.answer === 'both') { add(p.a, 0.5); add(p.b, 0.5); }
  }
  const lead = [...score.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0]?.[0];
  const shown = new Set(pairs.flatMap((p) => [p.a, p.b]));
  const fresh = DISH_TYPES.filter((d) => d !== 'drinks' && d !== 'desserts' && !shown.has(d) && d !== lead).sort((a, b) => Number(available.has(b)) - Number(available.has(a)));
  if (lead) return [lead, fresh[0] ?? 'pastries'];
  return [fresh[0] ?? 'shawarma', fresh[1] ?? 'pastries'];
}

/** Who you eat with, then three photo pairs. No points, a skip on every step, about 20 seconds. */
export function TasteGame({ dishes, onClose }: { dishes: BandDish[]; onClose: () => void }) {
  const t = useT();
  const { L } = useI18n();
  const taste = useTaste();
  const [party, setParty] = useState<Party | undefined>(taste.doc?.quiz?.party ?? undefined);
  const [pairs, setPairs] = useState<TastePair[]>([]);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Each type is pictured by a live dish of that type in the city. Owners sometimes tag a snack with a
  // main's type (pizza-flavoured crisps as "pizza"), so dishes priced far below the type's median are
  // left out, then most-ordered, open and dishes named after the type come first.
  const photos = useMemo(() => {
    const m = new Map<DishType, { path: string; name: string }>();
    for (const type of DISH_TYPES) {
      const ofType = dishes.filter((d) => d.entry.dishType === type && d.entry.imagePath && d.entry.available);
      if (!ofType.length) continue;
      const prices = ofType.map((d) => d.entry.priceAgorot).sort((a, b) => a - b);
      const median = prices[Math.floor(prices.length / 2)]!;
      const words = DISH_TYPE_WORDS[type].toLowerCase().split(' ').filter((w) => w.length > 2);
      const named = (d: BandDish) => words.some((w) => allWords(d.entry.name).toLowerCase().includes(w));
      const pick = ofType
        .filter((d) => d.entry.priceAgorot >= median * 0.6)
        .sort((a, b) => Number(!!b.entry.mostOrdered) - Number(!!a.entry.mostOrdered) || Number(b.open) - Number(a.open) || Number(named(b)) - Number(named(a)) || b.entry.priceAgorot - a.entry.priceAgorot)[0];
      if (pick) m.set(type, { path: pick.entry.imagePath!, name: L(pick.entry.name) });
    }
    return m;
  }, [dishes, L]);
  const available = useMemo(() => new Set(dishes.map((d) => d.entry.dishType).filter((d): d is DishType => !!d)), [dishes]);

  const pairFor = (s: number): [DishType, DishType] => (s === 1 ? ['burger', 'pizza'] : s === 2 ? thirdPair(pairs[0]) : fourthPair(pairs, available));
  const finish = async (finalPairs: TastePair[], finalParty: Party | undefined) => {
    setSaving(true);
    try {
      await taste.actions.saveQuiz({ ...(finalParty ? { party: finalParty } : {}), pairs: finalPairs });
      toast(t('taste.game.done'));
      onClose();
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
      setSaving(false);
    }
  };
  const next = (nextPairs: TastePair[], nextParty: Party | undefined) => {
    if (step + 1 >= QUESTIONS) void finish(nextPairs, nextParty);
    else setStep(step + 1);
  };
  const pick = (answer: PairAnswer) => {
    const [a, b] = pairFor(step);
    const nextPairs = [...pairs, { a, b, answer }];
    setPairs(nextPairs);
    next(nextPairs, party);
  };

  const [a, b]: [DishType, DishType] = step > 0 ? pairFor(step) : ['burger', 'pizza'];
  const tile = (type: DishType, answer: PairAnswer) => {
    const photo = photos.get(type);
    return (
      <button type="button" className={`tgame__pick ${photo ? '' : 'tgame__pick--blank'}`} onClick={() => pick(answer)} disabled={saving}>
        {photo ? <StorageImage path={photo.path} alt="" fallbackLabel="" /> : null}
        <span>{t(`dishType.${type}`)}</span>
      </button>
    );
  };

  return (
    <Dialog open onClose={onClose} title={t('taste.game.title')}>
      <div className="tgame">
        <div className="tgame__progress">
          <span className="tgame__bars" aria-hidden="true">{Array.from({ length: QUESTIONS }, (_, i) => <i key={i} className={i <= step ? 'is-on' : ''} />)}</span>
          <span>{t('taste.game.step', { n: step + 1, total: QUESTIONS })}</span>
          <Button variant="ghost" size="sm" onClick={() => next(pairs, party)} disabled={saving}>{t('taste.game.skip')}</Button>
        </div>
        <div className="tgame__step" key={step}>
          {step === 0 ? (
            <>
              <h3 className="tgame__q">{t('taste.game.who')}</h3>
              <div className="tgame__parties" style={{ marginTop: 'var(--space-4)' }}>
                {PARTIES.map((p) => (
                  <button key={p} type="button" className="tgame__party" aria-pressed={party === p} onClick={() => { setParty(p); next(pairs, p); }}>
                    <Icon name={PARTY_ICONS[p]} size={28} />{t(`taste.party.${p}`)}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <h3 className="tgame__q">{t('taste.game.pick')}</h3>
              <div className="tgame__pair" style={{ marginTop: 'var(--space-4)' }}>
                {tile(a, 'a')}
                {tile(b, 'b')}
                <span className="tgame__or" aria-hidden="true">{t('taste.game.or')}</span>
              </div>
              <div className="tgame__other" style={{ marginTop: 'var(--space-3)' }}>
                <Button variant="secondary" onClick={() => pick('both')} disabled={saving}>{t('taste.game.both')}</Button>
                <Button variant="secondary" onClick={() => pick('neither')} disabled={saving}>{t('taste.game.neither')}</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Right after sign-in, when this device holds picks made while signed out: keep them in the account
 * or start fresh. Both buttons are the same size; either way the device copy is cleared.
 */
export function TasteMerge() {
  const t = useT();
  const { user } = useAuth();
  const local = localTaste.use();
  const [busy, setBusy] = useState<'link' | 'fresh' | null>(null);
  const doc = local.doc;
  const session = tasteSession.use();
  const open = !!user && !!(doc?.consent || doc?.quiz) && !session.mergeLater;
  const choose = async (choice: 'link' | 'fresh') => {
    if (!doc) return;
    setBusy(choice);
    try {
      await call('mergeTaste', {
        choice,
        local: {
          ...(doc.consent ? { consent: { orders: doc.consent.orders, learn: doc.consent.learn, ai: doc.consent.ai, version: doc.consent.version, locale: doc.consent.locale } } : {}),
          ...(doc.quiz ? { quiz: { ...(doc.quiz.party ? { party: doc.quiz.party } : {}), pairs: doc.quiz.pairs, at: doc.quiz.at } } : {}),
          ...(doc.suppressed.length ? { suppressed: doc.suppressed } : {}),
        },
      });
      localTaste.reset();
      tasteSession.set({ consentShown: true });
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
    } finally {
      setBusy(null);
    }
  };
  // Closing without a choice keeps the device's picks and asks again on the next visit.
  return (
    <Dialog open={open} onClose={() => tasteSession.set({ mergeLater: true })} title={t('taste.merge.title')}>
      <div className="tconsent">
        <p style={{ margin: 0 }}>{t('taste.merge.body')}</p>
        <div className="tconsent__actions">
          <Button onClick={() => void choose('link')} loading={busy === 'link'} disabled={!!busy}>{t('taste.merge.link')}</Button>
          <Button variant="secondary" onClick={() => void choose('fresh')} loading={busy === 'fresh'} disabled={!!busy}>{t('taste.merge.fresh')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
