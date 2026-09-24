import { Link } from 'react-router';
import { useI18n, useT } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { Icon } from '@/design/Icon';
import { Badge, Button, toast } from '@/design/components';
import { LanguageSelect } from '@/app/Shell';
import { errorKey } from '@/lib/errors';
import { useConfirmNavigation } from './BusinessExperience';
import { BranchChip, BusinessSwitcher, PageTitle, useDash, useNavSections } from './shell';

/** Phone "More" tab: identity, the management links the sidebar shows on desktop, language, sign out. */
export function MorePage() {
  const t = useT();
  const { L } = useI18n();
  const { business, branch, branches, role } = useDash();
  const { memberships, signOut } = useAuth();
  const confirmNavigation = useConfirmNavigation();
  const sections = useNavSections().filter((s) => s.id === 'branch' || s.id === 'business');
  const branchName = L(branch.name, business.defaultLocale);
  return (
    <div className="stack more">
      <PageTitle title={t('common.more')} />
      <section className="card more__identity" aria-label={t('dash.switchBranch')}>
        <BranchChip variant="identity" />
        <div className="row more__meta">
          <span className="muted">{t(`staff.role.${role}`)} · {t(branches.length === 1 ? 'dash.branchCount.one' : 'dash.branchCount', { count: branches.length })}</span>
          {branch.approval !== 'approved' ? <Badge tone={branch.approval === 'pending' ? 'accent' : 'danger'}>{t(`admin.state.${branch.approval}`)}</Badge> : null}
          {business.approval !== 'approved' ? <Badge tone={business.approval === 'pending' ? 'accent' : 'danger'}>{t(`admin.state.${business.approval}`)}</Badge> : null}
        </div>
      </section>
      {sections.map((sec) => (
        <section key={sec.id} className="card more__group" aria-labelledby={`more-${sec.id}`}>
          <h2 id={`more-${sec.id}`} className="more__group-title">{sec.id === 'branch' ? branchName : L(business.name, business.defaultLocale)}</h2>
          <ul className="more__list">
            {sec.items.map((n) => (
              <li key={n.to}>
                <Link to={n.to} className="more__row">
                  <Icon name={n.icon} size={22} />
                  <span className="more__row-text">{n.label}</span>
                  <Icon name="chevron" size={20} directional className="icon icon--dir more__row-chev" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="card more__group" aria-labelledby="more-lang">
        <h2 id="more-lang" className="more__group-title">{t('common.language')}</h2>
        <div className="more__pad"><LanguageSelect /></div>
      </section>
      {memberships.length > 1 ? (
        <section className="card more__group" aria-labelledby="more-biz">
          <h2 id="more-biz" className="more__group-title">{t('dash.switchBusiness')}</h2>
          <div className="more__pad"><BusinessSwitcher currentBusinessId={business.id} /></div>
        </section>
      ) : null}
      <Link to="/" className="btn btn--secondary btn--block"><Icon name="external" size={18} />{t('common.goHome')}</Link>
      <Button variant="danger" block icon="logout" onClick={() => { if (confirmNavigation()) void signOut().catch((e) => toast(t(errorKey(e)), 'danger')); }}>{t('common.signOut')}</Button>
    </div>
  );
}
