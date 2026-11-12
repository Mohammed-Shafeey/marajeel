import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useAnalytics, usePlayers, useSessions, useSettings, type AnalyticsWindow } from '../api/hooks';
import type { PairStats, Player } from '../api/types';
import { useAuth } from '../auth/useAuth';
import { Avatar, PlayerCard, PositionChip, RatingDelta } from '../components/cards';
import { IconEdit } from '../components/icons';
import { ErrorState, IconButton, LoadingList, SectionTitle, Segmented, Skeleton, TopBar } from '../components/ui';
import { RatingChart } from '../components/RatingChart';
import { fmtDate, fmtNum, fmtPct, fmtSigned } from '../i18n';
import { compareNames } from '../lib/arabic';
import { tierOf } from '../lib/teamRating';
import PlayerEditSheet from './PlayerEditSheet';

export default function PlayerDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const auth = useAuth();
  const players = usePlayers();
  const { settings } = useSettings();
  const [window, setWindow] = useState<AnalyticsWindow>('all');
  const all = useAnalytics('all');
  const windowed = useAnalytics(window);
  const month = useAnalytics('month');
  const monthDelta = month.data?.players.find((s) => s.playerId === id)?.ratingDelta ?? 0;
  const sessions = useSessions();
  const [editing, setEditing] = useState(false);
  const [compareId, setCompareId] = useState('');

  const player = players.data?.find((p) => p.id === id);
  const playerMap = useMemo(() => new Map((players.data ?? []).map((p) => [p.id, p])), [players.data]);
  const statsAll = all.data?.players.find((s) => s.playerId === id);
  const stats = windowed.data?.players.find((s) => s.playerId === id);
  const pairs = useMemo(() => (windowed.data?.pairs ?? []).filter((p) => p.a === id || p.b === id), [windowed.data, id]);
  const other = (p: PairStats) => (p.a === id ? p.b : p.a);
  const myWins = (p: PairStats) => (p.a === id ? p.against.aWins : p.against.bWins);

  if (players.isLoading || all.isLoading) return (<><TopBar back title={t('player.title')} /><div className="page"><Skeleton className="mx-auto h-[300px] w-[200px]" /><div className="mt-4"><LoadingList /></div></div></>);
  if (!player) return (<><TopBar back title={t('player.title')} /><div className="page"><ErrorState error={players.error ?? new Error('not found')} /></div></>);

  const tier = tierOf(statsAll?.rating ?? 0, statsAll?.provisional ?? true, settings);
  const mates = pairs.filter((p) => p.together.games >= settings.minChemistryGames).sort((a, b) => b.together.chemistry - a.together.chemistry);
  const opponents = pairs.filter((p) => p.against.games > 0).sort((a, b) => b.against.games - a.against.games).slice(0, 6);
  const compare = compareId ? pairs.find((p) => other(p) === compareId) : undefined;
  const sessionDates = new Map((sessions.data ?? []).map((s) => [s.id, s.date]));
  const perSession = Object.entries(stats?.gamesBySession ?? {})
    .map(([sid, n]) => ({ sid, n, date: sessionDates.get(sid) ?? '' }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);

  return (
    <>
      <TopBar
        back="/players"
        title={t('player.title')}
        actions={auth.isAdmin && <IconButton label={t('players.edit')} className="!text-white" onClick={() => setEditing(true)}><IconEdit /></IconButton>}
      />
      <section className="tx-halftone relative overflow-hidden bg-brand px-4 pb-6 pt-4 text-on-brand">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 sm:flex-row sm:items-end">
          <PlayerCard player={player} stats={statsAll} settings={settings} team="a" className="card-reveal" />
          <div className="flex flex-col items-center gap-1 sm:items-start">
            <h2 className="font-display text-h1 font-extrabold !leading-snug">{player.name}</h2>
            <div className="flex flex-wrap items-center justify-center gap-2 text-small font-semibold">
              <span className="bg-ink px-2 py-0.5 text-on-ink">{t(`card.${tier === 'prov' ? 'provisional' : tier}`, { n: statsAll?.games ?? 0, of: settings.provisionalGames })}</span>
              {statsAll?.bestPosition && <span>{t('players.bestPosition', { pos: t(`pos.${statsAll.bestPosition}`) })}</span>}
              <span>· {t('players.since', { date: fmtDate(player.createdAt, { month: 'long', year: 'numeric' }) })}</span>
            </div>
            {monthDelta !== 0 && (
              <span className="flex items-center gap-1 bg-surface px-2 py-0.5 text-small text-fg">
                <RatingDelta delta={monthDelta} /> {t('common.thisMonth')}
              </span>
            )}
          </div>
        </div>
      </section>

      <div className="page">
        <Segmented
          label={t('common.allTime')}
          value={window}
          onChange={setWindow}
          options={[
            { value: 'month', label: t('common.thisMonth') },
            { value: 'all', label: t('common.allTime') },
          ]}
        />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label={t('player.winRate')} value={stats && stats.games ? fmtPct(stats.winPct) : '—'} />
          <Tile label={t('player.mvps')} value={fmtNum(stats?.mvps ?? 0)} accent />
          <Tile label={t('player.streak')} value={fmtNum(stats?.currentStreak ?? 0)} sub={`${t('player.longest')} ${fmtNum(stats?.longestStreak ?? 0)}`} />
          <Tile label={t('player.played')} value={fmtNum(stats?.games ?? 0)} />
        </div>

        <SectionTitle>{t('player.history')}</SectionTitle>
        <div className="card-panel p-3">
          <RatingChart points={statsAll?.ratingHistory ?? []} />
        </div>

        <SectionTitle>{t('player.byPosition')}</SectionTitle>
        <ul className="card-panel divide-y divide-[var(--border)]">
          {settings.positionTemplate
            .slice()
            .sort((a, b) => (statsAll?.positions.find((p) => p.position === b)?.rating ?? 0) - (statsAll?.positions.find((p) => p.position === a)?.rating ?? 0))
            .map((pos) => {
              const ps = statsAll?.positions.find((p) => p.position === pos);
              const thin = !ps || ps.games < settings.minPositionGames;
              return (
                <li key={pos} className="flex min-h-[52px] items-center gap-3 px-3">
                  <PositionChip position={pos} best={statsAll?.bestPosition === pos} />
                  <div className="h-2 flex-1 bg-surface-3">
                    {ps && <div className="h-2" style={{ width: `${ps.rating}%`, background: thin ? 'var(--border-strong)' : 'var(--brand)' }} />}
                  </div>
                  <span className={`num w-9 text-end text-h3 font-extrabold ${thin ? 'text-fg-3' : ''}`}>{ps ? fmtNum(ps.rating) : '—'}</span>
                  <span className="w-16 text-end text-caption text-fg-3">{t('count.games', { count: ps?.games ?? 0 })}</span>
                </li>
              );
            })}
        </ul>

        <SectionTitle>{t('player.bestMates')}</SectionTitle>
        {mates.length === 0 ? (
          <p className="card-panel p-4 text-small text-fg-3">{t('common.notEnoughData')}</p>
        ) : (
          <ul className="card-panel divide-y divide-[var(--border)]">
            {[...mates.slice(0, 3), ...(mates.length > 4 ? mates.slice(-2).filter((m) => m.together.chemistry < 0) : [])].map((p) => (
              <PairRow key={other(p)} player={playerMap.get(other(p))} pair={p} />
            ))}
          </ul>
        )}

        <SectionTitle>{t('player.h2h')}</SectionTitle>
        <div className="card-panel p-3">
          {opponents.length === 0 ? (
            <p className="text-small text-fg-3">{t('common.notEnoughData')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {opponents.map((p) => {
                const w = myWins(p);
                const l = p.against.games - w;
                return (
                  <li key={other(p)} className="flex items-center gap-2">
                    <span className="w-28 truncate text-small font-semibold">{t('player.h2hAgainst', { name: playerMap.get(other(p))?.name.split(' ')[0] ?? '?' })}</span>
                    <div className="flex h-6 flex-1 overflow-hidden" aria-label={t('player.record', { w, l })}>
                      <div className="flex items-center justify-center bg-win text-caption font-bold text-white" style={{ width: `${(w / p.against.games) * 100}%` }}>{w > 0 && fmtNum(w)}</div>
                      <div className="flex items-center justify-center bg-loss text-caption font-bold text-white" style={{ width: `${(l / p.against.games) * 100}%` }}>{l > 0 && fmtNum(l)}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-caption text-fg-3">{t('player.h2hLegend', { name: player.name.split(' ')[0] })}</p>

          <label className="field-label mt-4" htmlFor="cmp">{t('player.compare')}</label>
          <select id="cmp" className="w-full" value={compareId} onChange={(e) => setCompareId(e.target.value)}>
            <option value="">—</option>
            {(players.data ?? []).filter((p) => p.id !== id).sort((a, b) => compareNames(a.name, b.name)).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {compareId && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Tile label={t('player.asTeammates')} value={compare ? t('player.record', { w: compare.together.wins, l: compare.together.games - compare.together.wins }) : '—'} sub={compare && compare.together.games >= settings.minChemistryGames ? `${t('boards.chemistry')} ${fmtSigned(compare.together.chemistry * 20, 1)}` : t('common.notEnoughData')} />
              <Tile label={t('player.asOpponents')} value={compare ? t('player.record', { w: myWins(compare), l: compare.against.games - myWins(compare) }) : '—'} />
            </div>
          )}
        </div>

        {perSession.length > 0 && (
          <>
            <SectionTitle>{t('player.gamesPerSession')}</SectionTitle>
            <ul className="card-panel flex flex-col gap-1 p-3">
              {perSession.map((s) => (
                <li key={s.sid}>
                  <Link to={`/sessions/${s.sid}/games`} className="flex min-h-[36px] items-center gap-2">
                    <span className="w-24 text-small">{s.date && fmtDate(s.date, { day: 'numeric', month: 'short' })}</span>
                    <div className="h-3 flex-1 bg-surface-3"><div className="h-3 bg-ink" style={{ width: `${Math.min(100, (s.n / 9) * 100)}%` }} /></div>
                    <span className="num w-6 text-end font-bold">{fmtNum(s.n)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <PlayerEditSheet player={player} open={editing} onClose={() => setEditing(false)} />
    </>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`flex flex-col gap-0.5 p-3 ${accent ? 'bg-volt text-on-volt' : 'card-panel'}`}>
      <span className="num text-[32px] font-extrabold leading-none">{value}</span>
      <span className="text-caption font-bold uppercase opacity-80">{label}</span>
      {sub && <span className="text-caption opacity-80">{sub}</span>}
    </div>
  );
}

function PairRow({ player, pair }: { player?: Player; pair: PairStats }) {
  const { t } = useTranslation();
  const chem = pair.together.chemistry * 20;
  return (
    <li>
      <Link to={player ? `/players/${player.id}` : '#'} className="flex min-h-[60px] items-center gap-3 px-3">
        <Avatar player={player} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold">{player?.name ?? t('common.unknownPlayer')}</div>
          <div className="text-caption text-fg-2">
            {t('player.togetherLine', { games: t('count.games', { count: pair.together.games }), pct: fmtPct(pair.together.wins / pair.together.games) })}
          </div>
        </div>
        <span className={`num text-h2 font-extrabold ${chem > 0.5 ? 'text-win' : chem < -0.5 ? 'text-loss' : 'text-fg-3'}`}>{fmtSigned(chem, 1)}</span>
      </Link>
    </li>
  );
}
