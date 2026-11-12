import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useDeleteSession, useSession, useUpdateSession } from '../api/hooks';
import { useAuth } from '../auth/useAuth';
import { IconLock, IconTrash } from '../components/icons';
import { ErrorState, IconButton, LoadingList, TopBar, errorMessage, useConfirm, useToast } from '../components/ui';
import { fmtDate } from '../i18n';
import CheckInTab from './session/CheckInTab';
import GamesTab from './session/GamesTab';
import TeamBuilderTab from './session/TeamBuilderTab';
import { sessionName } from './SessionsPage';

const TABS = ['checkin', 'teams', 'games'] as const;
type Tab = (typeof TABS)[number];

export default function SessionPage() {
  const { id, tab: rawTab } = useParams();
  const { t } = useTranslation();
  const nav = useNavigate();
  const auth = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const session = useSession(id);
  const update = useUpdateSession();
  const del = useDeleteSession();
  const s = session.data;
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : s && s.teams.length ? 'games' : 'checkin';

  const toggleStatus = () =>
    s && update.mutate({ id: s.id, date: s.date, notes: s.notes, status: s.status === 'open' ? 'closed' : 'open' }, { onError: (e) => toast(errorMessage(e, t), 'error') });
  const remove = async () => {
    if (!s || !(await confirm(t('sessions.deleteConfirm'), { danger: true, confirmLabel: t('common.delete') }))) return;
    del.mutate(s.id, { onSuccess: () => nav('/'), onError: (e) => toast(errorMessage(e, t), 'error') });
  };

  return (
    <>
      <TopBar
        back="/"
        title={s ? s.notes || sessionName(s, t) : t('common.loading')}
        subtitle={s && `${fmtDate(s.date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${s.status === 'open' ? t('sessions.open') : t('sessions.closed')}`}
        actions={
          auth.isAdmin && s && (
            <>
              <IconButton label={s.status === 'open' ? t('sessions.close') : t('sessions.reopen')} className="!text-white" onClick={toggleStatus}>
                <IconLock />
              </IconButton>
              <IconButton label={t('common.delete')} className="!text-white" onClick={() => void remove()}>
                <IconTrash />
              </IconButton>
            </>
          )
        }
      />
      <div className="tabs sticky top-[60px] z-20 lg:top-0" role="tablist">
        {TABS.map((k) => (
          <Link key={k} role="tab" aria-selected={tab === k} to={`/sessions/${id}/${k}`} replace className="tab flex items-center justify-center">
            {t(`sessions.tabs.${k}`)}
          </Link>
        ))}
      </div>
      {session.isLoading ? (
        <div className="page"><LoadingList rows={6} height="h-24" /></div>
      ) : session.error || !s ? (
        <div className="page"><ErrorState error={session.error} onRetry={() => void session.refetch()} /></div>
      ) : tab === 'checkin' ? (
        <CheckInTab session={s} />
      ) : tab === 'teams' ? (
        <TeamBuilderTab session={s} />
      ) : (
        <GamesTab session={s} />
      )}
    </>
  );
}
