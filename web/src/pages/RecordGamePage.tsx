import { DndContext, DragOverlay, useDraggable, type DragEndEvent } from '@dnd-kit/core';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useDeleteGame, usePlayers, useRatingContext, useSaveGame, useSession, useSettings } from '../api/hooks';
import type { Game, SessionDetail, Team } from '../api/types';
import { useAuth } from '../auth/useAuth';
import { MiniCard } from '../components/cards';
import { Court, TeamBand, WinProbBar, parseDragId, useCourtSensors, type CourtSide } from '../components/Court';
import { IconMinus, IconPlus, IconSync, IconTrash } from '../components/icons';
import { Button, ErrorState, IconButton, LoadingList, SectionTitle, TopBar, errorMessage, translateCode, useConfirm, useToast } from '../components/ui';
import { fmtNum } from '../i18n';
import { newGuid } from '../lib/rng';
import { teamRating, winProbability } from '../lib/teamRating';
import { scoreLooksFinished, validateGame } from '../lib/validation';

type Slots = Record<number, string | undefined>;

export default function RecordGamePage() {
  const { id: sessionId, gameId } = useParams();
  const { t } = useTranslation();
  const session = useSession(sessionId);
  if (session.isLoading) return (<><TopBar back title={t('common.loading')} /><div className="page"><LoadingList rows={3} height="h-40" /></div></>);
  if (!session.data) return (<><TopBar back title={t('game.record')} /><div className="page"><ErrorState error={session.error} onRetry={() => void session.refetch()} /></div></>);
  const existing = gameId ? session.data.games.find((g) => g.id === gameId) : undefined;
  if (gameId && !existing) return (<><TopBar back title={t('game.edit')} /><div className="page"><ErrorState error={new Error('not found')} /></div></>);
  return <GameEditor key={gameId ?? 'new'} session={session.data} existing={existing} />;
}

function baseSlots(s: SessionDetail, teamId: string): Slots {
  const m: Slots = {};
  for (const p of s.players) if (p.teamId === teamId && !p.isBench && p.position) m[p.position] = p.playerId;
  return m;
}

/** Default matchup: winner of the last game stays on against the team that rested. */
function defaultTeams(s: SessionDetail): [string, string] {
  const ids = s.teams.map((x) => x.id);
  const last = s.games[s.games.length - 1];
  if (!last || ids.length < 3) return [ids[0], ids[1]];
  const winner = last.scoreA > last.scoreB ? last.teamAId : last.teamBId;
  const rested = ids.find((x) => x !== last.teamAId && x !== last.teamBId)!;
  return [winner, rested];
}

function GameEditor({ session, existing }: { session: SessionDetail; existing?: Game }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const auth = useAuth();
  const players = usePlayers();
  const { settings } = useSettings();
  const { ctx } = useRatingContext();
  const saveGame = useSaveGame();
  const deleteGame = useDeleteGame();
  const sensors = useCourtSensors();
  const editable = auth.isAdmin;
  const template = settings.positionTemplate;

  const [[teamAId, teamBId], setTeams] = useState<[string, string]>(() => (existing ? [existing.teamAId, existing.teamBId] : defaultTeams(session)));
  const fromGame = (side: 'A' | 'B') => {
    const m: Slots = {};
    existing?.participants.filter((p) => p.side === side).forEach((p) => (m[p.position] = p.playerId));
    return m;
  };
  const [slotsA, setSlotsA] = useState<Slots>(() => (existing ? fromGame('A') : baseSlots(session, teamAId)));
  const [slotsB, setSlotsB] = useState<Slots>(() => (existing ? fromGame('B') : baseSlots(session, teamBId)));
  const [scoreA, setScoreA] = useState(existing?.scoreA ?? 0);
  const [scoreB, setScoreB] = useState(existing?.scoreB ?? 0);
  const [mvp, setMvp] = useState<string | null>(existing?.mvpPlayerId ?? null);
  const [showChem, setShowChem] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [id] = useState(() => existing?.id ?? newGuid());

  const teamA = session.teams.find((x) => x.id === teamAId) as Team;
  const teamB = session.teams.find((x) => x.id === teamBId) as Team;
  const playerMap = useMemo(() => new Map((players.data ?? []).map((p) => [p.id, p])), [players.data]);
  const baseA = useMemo(() => baseSlots(session, teamAId), [session, teamAId]);
  const baseB = useMemo(() => baseSlots(session, teamBId), [session, teamBId]);
  const changedA = new Set(template.filter((p) => slotsA[p] !== baseA[p]));
  const changedB = new Set(template.filter((p) => slotsB[p] !== baseB[p]));
  const changes = changedA.size + changedB.size;
  const onCourt = new Set([...Object.values(slotsA), ...Object.values(slotsB)].filter(Boolean) as string[]);
  const subs = session.players.filter((p) => !onCourt.has(p.playerId)).map((p) => p.playerId);
  const toSlots = (s: Slots) => Object.entries(s).filter(([, v]) => v).map(([pos, pid]) => ({ playerId: pid!, position: Number(pos) }));
  const rA = teamRating(ctx, toSlots(slotsA));
  const rB = teamRating(ctx, toSlots(slotsB));
  const restingTeam = session.teams.find((x) => x.id !== teamAId && x.id !== teamBId);
  const gameNumber = existing ? session.games.findIndex((g) => g.id === existing.id) + 1 : session.games.length + 1;

  // If the MVP leaves the court, clear it.
  useEffect(() => {
    if (mvp && !onCourt.has(mvp)) setMvp(null);
  }, [mvp, onCourt]);

  const chooseTeams = (a: string, b: string) => {
    setTeams([a, b]);
    setSlotsA(baseSlots(session, a));
    setSlotsB(baseSlots(session, b));
    setMvp(null);
  };

  const sideSlots = (side: CourtSide) => (side === 'bottom' ? [slotsA, setSlotsA] : [slotsB, setSlotsB]) as [Slots, React.Dispatch<React.SetStateAction<Slots>>];

  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    if (!e.over || !editable) return;
    const from = parseDragId(String(e.active.id));
    const to = parseDragId(String(e.over.id));
    if (!from || !to || to.kind !== 'slot') return;
    const [toSlotsState, setTo] = sideSlots(to.side);
    if (from.kind === 'bench') {
      setTo({ ...toSlotsState, [to.pos]: from.playerId });
      return;
    }
    if (from.side === to.side) {
      const [s, set] = sideSlots(from.side);
      set({ ...s, [from.pos]: s[to.pos], [to.pos]: s[from.pos] });
    } else {
      // Across the net: the two players change teams for this game.
      const [fromState, setFrom] = sideSlots(from.side);
      const a = fromState[from.pos];
      setFrom({ ...fromState, [from.pos]: toSlotsState[to.pos] });
      setTo({ ...toSlotsState, [to.pos]: a });
    }
  };

  const resetToBase = () => {
    setSlotsA(baseA);
    setSlotsB(baseB);
  };

  const build = (): Game => ({
    id,
    sessionId: session.id,
    teamAId,
    teamBId,
    scoreA,
    scoreB,
    mvpPlayerId: mvp ?? '',
    playedAt: existing?.playedAt ?? new Date().toISOString(),
    participants: [
      ...toSlots(slotsA).map((s) => ({ playerId: s.playerId, side: 'A' as const, position: s.position })),
      ...toSlots(slotsB).map((s) => ({ playerId: s.playerId, side: 'B' as const, position: s.position })),
    ],
  });

  const submit = async () => {
    const g = build();
    const errs = validateGame(g, settings, new Set(session.teams.map((x) => x.id)), new Set(session.players.map((p) => p.playerId)));
    if (errs.length) return toast(translateCode(errs[0].code, errs[0].params, t), 'error');
    if (!scoreLooksFinished(scoreA, scoreB, settings) && !(await confirm(t('game.notFinished', { n: settings.targetScore })))) return;
    saveGame.mutate(g, {
      onSuccess: (sent) => {
        toast(sent ? t('common.saved') : t('game.saveQueued'), sent ? 'ok' : 'info');
        nav(`/sessions/${session.id}/games`, { replace: true });
      },
      onError: (e) => toast(errorMessage(e, t), 'error'),
    });
  };

  const remove = async () => {
    if (!existing || !(await confirm(t('game.deleteConfirm'), { danger: true, confirmLabel: t('common.delete') }))) return;
    deleteGame.mutate({ id: existing.id, sessionId: session.id }, {
      onSuccess: () => {
        toast(t('common.deleted'));
        nav(`/sessions/${session.id}/games`, { replace: true });
      },
      onError: (e) => toast(errorMessage(e, t), 'error'),
    });
  };

  if (session.teams.length < 2)
    return (<><TopBar back title={t('game.record')} /><div className="page"><ErrorState error={new Error(t('game.needTeams'))} /></div></>);

  const draggingPlayer = (() => {
    const d = dragId && parseDragId(dragId);
    if (!d) return undefined;
    if (d.kind === 'bench') return d.playerId;
    return sideSlots(d.side)[0][d.pos];
  })();

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setDragId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
      <TopBar
        back
        title={t('game.title', { n: gameNumber })}
        subtitle={existing?.pending ? t('game.pending') : undefined}
        actions={
          editable && existing && (
            <IconButton label={t('common.delete')} className="!text-white" onClick={() => void remove()}>
              <IconTrash />
            </IconButton>
          )
        }
      />
      <div className="page lg:grid lg:grid-cols-[420px_1fr] lg:gap-6">
        <div>
          {/* Team picker */}
          {editable && !existing && session.teams.length > 2 && (
            <div className="mb-2 flex flex-wrap items-center gap-2" role="group" aria-label={t('game.chooseTeams')}>
              {pairsOf(session.teams).map(([a, b]) => {
                const active = (a.id === teamAId && b.id === teamBId) || (a.id === teamBId && b.id === teamAId);
                return (
                  <button key={a.id + b.id} type="button" aria-pressed={active} className="chip" onClick={() => chooseTeams(a.id, b.id)}>
                    <span style={{ color: active ? undefined : `var(--team-${a.color}-line)` }}>{a.label}</span>
                    <span className="opacity-60">{t('common.vs')}</span>
                    <span style={{ color: active ? undefined : `var(--team-${b.color}-line)` }}>{b.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="mb-2 flex items-stretch gap-2">
            <div className="flex-1"><TeamBand color={teamA.color} label={teamA.label} rating={rA} /></div>
            <span className="flex items-center font-display font-extrabold">{t('common.vs')}</span>
            <div className="flex-1"><TeamBand color={teamB.color} label={teamB.label} rating={rB} /></div>
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`px-2 py-1 font-display text-[14px] font-bold ${changes ? 'bg-cyan text-on-cyan' : 'bg-surface-2 text-fg-2'}`}>
              {t('game.modified', { count: changes })}
            </span>
            {editable && changes > 0 && (
              <button type="button" className="chip !bg-ink !text-on-ink" onClick={resetToBase}>
                <IconSync size={14} /> {t('game.resetToBase')}
              </button>
            )}
            {restingTeam && <span className="chip">{t('game.resting', { team: restingTeam.label })}</span>}
            <button type="button" className="chip ms-auto" aria-pressed={showChem} onClick={() => setShowChem((v) => !v)}>
              {t('game.chemistryLines')}
            </button>
          </div>

          <div className="mb-2">
            <WinProbBar pA={winProbability(rA, rB, template.length)} colorA={teamA.color} colorB={teamB.color} labelA={teamA.label} labelB={teamB.label} />
          </div>

          <Court
            top={{ color: teamB.color, slots: slotsB, changed: changedB }}
            bottom={{ color: teamA.color, slots: slotsA, changed: changedA }}
            players={playerMap}
            stats={ctx.stats}
            ctx={ctx}
            settings={settings}
            template={template}
            showChemistry={showChem}
            mvpId={mvp}
            editable={editable}
            activeDragId={dragId}
            onTapSlot={(_, __, pid) => editable && pid && setMvp(pid)}
          />
          {editable && <p className="mt-2 text-center text-small font-semibold text-fg-2">{t('game.pickMvp')}</p>}
        </div>

        <div>
          <SectionTitle>{t('game.score')}</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <ScoreBox team={teamA} value={scoreA} onChange={setScoreA} winner={scoreA > scoreB} editable={editable} />
            <ScoreBox team={teamB} value={scoreB} onChange={setScoreB} winner={scoreB > scoreA} editable={editable} />
          </div>
          <p className="mt-2 text-small text-fg-2">
            {t('game.firstTo', { n: settings.targetScore })}
            {settings.winByTwo ? ` ${t('game.winByTwo')}` : ''}
          </p>

          {editable && subs.length > 0 && (
            <>
              <SectionTitle aside={t('builder.benchHint')}>{t('game.subIn')}</SectionTitle>
              <div className="card-panel flex flex-wrap gap-3 p-3">
                {subs.map((pid) => (
                  <BenchCard key={pid} id={`bench:${pid}`}>
                    <MiniCard player={playerMap.get(pid)} stats={ctx.stats.get(pid)} settings={settings} benched className={draggingPlayer === pid ? 'opacity-30' : ''} />
                  </BenchCard>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(.34,1.3,.64,1)' }}>
        {draggingPlayer ? <MiniCard player={playerMap.get(draggingPlayer)} stats={ctx.stats.get(draggingPlayer)} settings={settings} dragging /> : null}
      </DragOverlay>

      {editable && (
        <div className="action-bar">
          <Button variant="primary" disabled={saveGame.isPending} onClick={() => void submit()}>
            {t('game.save')}
          </Button>
        </div>
      )}
    </DndContext>
  );
}

const pairsOf = <T,>(xs: T[]) => xs.flatMap((a, i) => xs.slice(i + 1).map((b) => [a, b] as [T, T]));

function BenchCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} role="presentation" style={{ touchAction: 'manipulation' }}>
      {children}
    </div>
  );
}

/** One team's score: big number (also typeable) + 112 px thumb buttons. */
function ScoreBox({ team, value, onChange, winner, editable }: { team: Team; value: number; onChange: React.Dispatch<React.SetStateAction<number>>; winner: boolean; editable: boolean }) {
  const { t } = useTranslation();
  const [tick, setTick] = useState(0);
  const clamp = (v: number) => Math.max(0, Math.min(99, v));
  // Functional updates so rapid taps never read a stale score.
  const bump = (d: number) => {
    onChange((v) => clamp(v + d));
    setTick((x) => x + 1);
  };
  const set = (v: number) => onChange(clamp(v));
  return (
    <div className={`card-panel overflow-hidden team-${team.color}`}>
      <div className={`pat-${team.color} flex items-center justify-between px-3 py-1 font-display text-[18px] font-extrabold`} style={{ background: 'var(--team)', color: 'var(--on-team)' }}>
        <span className="truncate">{team.label}</span>
        {winner && <span className="bg-ink px-1 text-caption text-on-ink">{t('team.winner')}</span>}
      </div>
      <div className="flex flex-col items-center gap-2 p-2">
        {editable ? (
          <input
            key={tick}
            type="number"
            inputMode="numeric"
            min={0}
            max={99}
            aria-label={`${t('game.score')} · ${team.label}`}
            value={value}
            onChange={(e) => set(Number(e.target.value.replace(/\D/g, '')) || 0)}
            className="score-tick num h-[76px] w-full !border-0 !bg-transparent text-center text-hero font-extrabold"
          />
        ) : (
          <span className="num text-hero font-extrabold">{fmtNum(value)}</span>
        )}
        {editable && (
          <div className="flex w-full gap-2">
            <button type="button" aria-label={t('game.decrease', { team: team.label })} className="btn btn-outline !h-[72px] flex-1 !px-0" disabled={value <= 0} onClick={() => bump(-1)}>
              <IconMinus size={30} />
            </button>
            <button type="button" aria-label={t('game.increase', { team: team.label })} className="btn btn-primary !h-[112px] flex-[2] !px-0" onClick={() => bump(1)}>
              <IconPlus size={40} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
