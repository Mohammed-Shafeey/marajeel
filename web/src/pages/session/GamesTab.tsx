import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { usePlayers } from '../../api/hooks';
import type { SessionDetail } from '../../api/types';
import { useAuth } from '../../auth/useAuth';
import { Avatar, Num } from '../../components/cards';
import { IconBall, IconChevron, IconPlus, IconSync } from '../../components/icons';
import { Button, EmptyState, SectionTitle } from '../../components/ui';
import { fmtNum } from '../../i18n';
import { firstName } from '../../lib/arabic';

export default function GamesTab({ session }: { session: SessionDetail }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const auth = useAuth();
  const players = usePlayers();
  const playerMap = useMemo(() => new Map((players.data ?? []).map((p) => [p.id, p])), [players.data]);
  const teams = new Map(session.teams.map((x) => [x.id, x]));

  // Fair playing time: games per checked-in player this session.
  const counts = useMemo(() => {
    const c = new Map<string, number>(session.players.map((p) => [p.playerId, 0]));
    for (const g of session.games) for (const p of g.participants) c.set(p.playerId, (c.get(p.playerId) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => a[1] - b[1]);
  }, [session]);
  const avg = counts.length ? counts.reduce((s, [, n]) => s + n, 0) / counts.length : 0;

  return (
    <>
      <div className="page">
        {session.games.length === 0 ? (
          <EmptyState
            icon={<IconBall size={40} />}
            title={t('game.noGames')}
            hint={session.teams.length ? t('game.noGamesHint') : t('game.needTeams')}
            action={
              auth.isAdmin &&
              (session.teams.length ? (
                <Button variant="primary" onClick={() => nav(`/sessions/${session.id}/games/new`)}>{t('game.record')}</Button>
              ) : (
                <Button onClick={() => nav(`/sessions/${session.id}/teams`)}>{t('sessions.tabs.teams')}</Button>
              ))
            }
          />
        ) : (
          <ol className="flex flex-col gap-2">
            {session.games.map((g, i) => {
              const ta = teams.get(g.teamAId);
              const tb = teams.get(g.teamBId);
              const aWon = g.scoreA > g.scoreB;
              const mvp = playerMap.get(g.mvpPlayerId);
              return (
                <li key={g.id}>
                  <Link to={`/sessions/${session.id}/games/${g.id}`} className="card-panel flex min-h-[72px] items-center gap-2 pe-2">
                    <span className="flex w-12 shrink-0 flex-col items-center self-stretch justify-center bg-ink text-on-ink">
                      <span className="text-caption font-bold opacity-80">#</span>
                      <Num n={i + 1} className="text-[22px] font-extrabold leading-none" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1 py-2">
                      <div className="flex items-center gap-2 font-display text-[19px] font-extrabold">
                        <span className={`truncate ${aWon ? '' : 'opacity-60'}`} style={{ color: `var(--team-${ta?.color ?? 'a'}-line)` }}>{ta?.label}</span>
                        <span className="num whitespace-nowrap">
                          <span className={aWon ? '' : 'opacity-60'}>{fmtNum(g.scoreA)}</span> – <span className={aWon ? 'opacity-60' : ''}>{fmtNum(g.scoreB)}</span>
                        </span>
                        <span className={`truncate ${aWon ? 'opacity-60' : ''}`} style={{ color: `var(--team-${tb?.color ?? 'b'}-line)` }}>{tb?.label}</span>
                      </div>
                      <div className="flex items-center gap-2 text-small">
                        <span className="bg-volt px-1 font-display text-[11px] font-extrabold text-on-volt">MVP</span>
                        <span className="truncate font-semibold">{mvp?.name ?? '—'}</span>
                        {g.pending && (
                          <span className="ms-auto flex items-center gap-1 bg-volt px-1 text-caption font-bold text-on-volt">
                            <IconSync size={12} /> {t('game.pending')}
                          </span>
                        )}
                      </div>
                    </div>
                    <IconChevron className="text-fg-3" />
                  </Link>
                </li>
              );
            })}
          </ol>
        )}

        {session.games.length > 0 && (
          <>
            <SectionTitle aside={t('boards.fairness', { avg: fmtNum(avg, { maximumFractionDigits: 1 }) })}>{t('player.gamesPerSession')}</SectionTitle>
            <ul className="card-panel grid grid-cols-2 gap-x-4 gap-y-1 p-3 sm:grid-cols-3">
              {counts.map(([id, n]) => (
                <li key={id} className="flex min-h-[40px] items-center gap-2">
                  <Avatar player={playerMap.get(id)} size={28} />
                  <span className="flex-1 truncate text-small font-semibold">{firstName(playerMap.get(id)?.name ?? '')}</span>
                  <span className={`num font-extrabold ${n < avg - 1.5 ? 'text-loss' : ''}`}>{fmtNum(n)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {auth.isAdmin && session.teams.length > 0 && session.games.length > 0 && (
        <div className="action-bar">
          <Button variant="primary" onClick={() => nav(`/sessions/${session.id}/games/new`)}>
            <IconPlus /> {t('game.record')}
          </Button>
        </div>
      )}
    </>
  );
}
