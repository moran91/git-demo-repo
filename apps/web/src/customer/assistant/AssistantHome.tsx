import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { homeView } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { Skeleton, toast } from '@/design/components';
import { Icon } from '@/design/Icon';
import { AssistantCard, bidi } from './Cards';
import type { AskState } from './AskPage';
import { useAssistantData } from './useAssistantData';
import { useQuickAdd } from './useQuickAdd';
import './assistant.css';

/**
 * The home's assistant (spec §2): the ask box (opens /ask), suggestion chips, then a greeting with up to
 * three ready picks. When every place is closed the greeting itself says when the first one opens.
 */
export function AssistantHome({ cityId }: { cityId: string }) {
  const t = useT();
  const { locale } = useI18n();
  const navigate = useNavigate();
  const { data, branches, loading, signedIn } = useAssistantData(cityId);
  const quick = useQuickAdd(cityId, data.profile?.usualMode);
  const view = useMemo(() => homeView(data, { signedIn, uiLang: locale }), [data, signedIn, locale]);
  const open = (state?: AskState) => void navigate('/ask', state ? { state } : undefined);
  // Usual lines that could not be reordered (a size or option is gone) are named, never dropped silently.
  const onDropped = (names: string[]) => toast(t('assistant.missing', { names: names.join(', ') }), 'danger');
  // A town with no restaurants: the places list below says so; "everything is closed" would be false.
  const none = !loading && data.places.size === 0;

  return (
    <section className="assist" aria-label={t('assistant.title')}>
      <button type="button" className="assist__ask" onClick={() => open()}>
        <Icon name="search" size={24} />
        <span>{t('assistant.ask')}</span>
      </button>
      {loading ? (
        <div className="assist__wait" aria-hidden="true">
          <Skeleton height={44} width="70%" radius={999} />
          <Skeleton height={22} width="45%" />
          <Skeleton height={98} radius={16} />
        </div>
      ) : none ? null : (
        <>
          {view.chips.length ? (
            <div className="ask__chips assist__chips" role="group" aria-label={t('assistant.suggestions')}>
              {view.chips.map((c, i) => <button key={i} type="button" className="ask__chip" onClick={() => open({ chip: c })}>{bidi(c.label)}</button>)}
            </div>
          ) : null}
          <p className={view.closedUntil ? 'ask__line assist__greeting assist__greeting--closed' : 'ask__line assist__greeting'}>
            <span className="ask__mark" aria-hidden="true">✦</span>
            <span>{bidi(view.greeting)}</span>
          </p>
          {view.cards.length ? (
            <div className="ask__cards">
              {view.cards.map((c, i) => <AssistantCard key={i} card={c} data={data} branches={branches} quick={quick} onDropped={onDropped} />)}
            </div>
          ) : null}
        </>
      )}
      {quick.layer}
    </section>
  );
}
