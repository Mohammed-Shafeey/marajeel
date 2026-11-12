import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useAnalytics, useCreateSession, usePlayers, useSessions } from '../api/hooks';
import type { SessionSummary } from '../api/types';
import { useAuth } from '../auth/useAuth';
import { Num } from '../components/cards';
import { IconCalendar, IconChevron, IconPlus } from '../components/icons';
import { Button, EmptyState, ErrorState, LoadingList, SectionTitle, Sheet, TopBar, errorMessage, useToast } from '../components/ui';
import { fmtDate, fmtWeekday } from '../i18n';

export const sessionName = (s: { date: string }, t: (k: string, o?: Record<string, unknown>) => string) =>
  t('sessions.defaultName', { day: fmtWeekday(s.date) });

export default function SessionsPage() {
  const { t } = useTranslation();
  const auth = useAuth();
  const sessions = useSessions();
  const players = usePlayers();
  const analytics = useAnalytics('all');
  const [creating, setCreating] = useState(false);

  const playerName = (id?: string) => players.data?.find((p) => p.id === id)?.name;
  const live = sessions.data?.find((s) => s.status === 'open');
  const past = sessions.data?.filter((s) => s !== live) ?? [];

  return (
    <>
      <TopBar
        title={t('app.name')}
        actions={
          !auth.loading &&
          (auth.isAdmin ? (
            <span className="bg-brand px-2 py-1 font-display text-caption font-extrabold uppercase text-on-brand">{t('settings.admin')}</span>
          ) : (
            <a href={auth.signInUrl} className="px-2 text-small font-semibold text-[#C3C2CB] underline">
              {t('common.signIn')}
            </a>
          ))
        }
      />
      <div className="page">
        {sessions.isLoading ? (
          <LoadingList rows={5} height="h-20" />
        ) : sessions.error ? (
          <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
        ) : sessions.data!.length === 0 ? (
          <EmptyState
            icon={<IconCalendar size={40} />}
            title={t('sessions.empty')}
            hint={t('sessions.emptyHint')}
            action={auth.isAdmin && <Button variant="primary" onClick={() => setCreating(true)}>{t('sessions.new')}</Button>}
          />
        ) : (
          <>
            {live && <LiveTile s={live} />}
            {past.length > 0 && (
              <>
                <SectionTitle aside={t('count.sessions', { count: past.length })}>{t('sessions.past')}</SectionTitle>
                <ul className="flex flex-col gap-2">
                  {past.map((s) => (
                    <li key={s.id}>
                      <Link to={`/sessions/${s.id}/games`} className="card-panel flex min-h-[72px] items-stretch">
                        <div className="flex w-16 shrink-0 flex-col items-center justify-center bg-ink text-on-ink">
                          <span className="num text-[26px] font-extrabold leading-none">{fmtDate(s.date, { day: 'numeric' })}</span>
                          <span className="text-caption font-bold">{fmtDate(s.date, { month: 'short' })}</span>
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col justify-center px-3 py-2">
                          <span className="truncate font-bold">{s.notes || sessionName(s, t)}</span>
                          <span className="text-small text-fg-2">
                            {t('count.players', { count: s.playerCount })} · {t('count.games', { count: s.gameCount })}
                          </span>
                          {analytics.data?.sessionMvps[s.id] && (
                            <span className="mt-0.5 flex items-center gap-1 text-small">
                              <span className="bg-volt px-1 font-display text-[11px] font-extrabold text-on-volt">MVP</span>
                              <span className="truncate font-semibold">{playerName(analytics.data.sessionMvps[s.id])}</span>
                            </span>
                          )}
                        </div>
                        <span className="flex items-center px-2 text-fg-3">
                          <IconChevron />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
      {auth.isAdmin && (sessions.data?.length ?? 0) > 0 && (
        <div className="action-bar">
          <Button variant="primary" onClick={() => setCreating(true)}>
            <IconPlus /> {t('sessions.new')}
          </Button>
        </div>
      )}
      <NewSessionSheet open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function LiveTile({ s }: { s: SessionSummary }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const nav = useNavigate();
  const hasTeams = s.teamCount > 0;
  return (
    <section className="panel panel-pink tx-halftone relative overflow-hidden px-4 pb-4 pt-3">
      <span className="tag-new">{t('sessions.live')}</span>
      <div className="text-small font-bold opacity-90">{fmtDate(s.date, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <h2 className="font-display text-display font-extrabold uppercase">{s.notes || sessionName(s, t)}</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        <span className="bg-ink px-2 py-0.5 font-display text-[15px] font-bold text-on-ink">{t('count.players', { count: s.playerCount })}</span>
        {hasTeams && <span className="bg-ink px-2 py-0.5 font-display text-[15px] font-bold text-on-ink">{t('count.teams', { count: s.teamCount })}</span>}
        <span className="bg-ink px-2 py-0.5 font-display text-[15px] font-bold text-on-ink">
          {t('count.games', { count: s.gameCount })}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {auth.isAdmin && hasTeams ? (
          <button type="button" className="btn btn-outline shadow-pop" onClick={() => nav(`/sessions/${s.id}/games/new`)}>
            {t('sessions.recordNext')} <IconChevron size={18} />
          </button>
        ) : (
          <button type="button" className="btn btn-outline shadow-pop" onClick={() => nav(`/sessions/${s.id}${hasTeams ? '/games' : '/checkin'}`)}>
            {t('sessions.openSession')} <IconChevron size={18} />
          </button>
        )}
        {auth.isAdmin && hasTeams && (
          <Link to={`/sessions/${s.id}/games`} className="btn btn-ink">
            <Num n={s.gameCount} /> · {t('sessions.tabs.games')}
          </Link>
        )}
      </div>
    </section>
  );
}

function NewSessionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const toast = useToast();
  const create = useCreateSession();
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState('');
  const submit = () =>
    create.mutate(
      { date, notes: notes.trim() || null },
      {
        onSuccess: (s) => {
          onClose();
          nav(`/sessions/${s.id}/checkin`);
        },
        onError: (e) => toast(errorMessage(e, t), 'error'),
      },
    );
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('sessions.new')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!date || create.isPending} onClick={submit}>
            {t('sessions.create')}
          </Button>
        </>
      }
    >
      <label className="field-label" htmlFor="s-date">{t('sessions.date')}</label>
      <input id="s-date" type="date" className="w-full" value={date} onChange={(e) => setDate(e.target.value)} />
      <label className="field-label mt-4" htmlFor="s-notes">{t('sessions.notes')}</label>
      <input id="s-notes" className="w-full" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
    </Sheet>
  );
}
