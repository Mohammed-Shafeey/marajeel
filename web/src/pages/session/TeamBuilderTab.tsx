import { DndContext, DragOverlay, useDraggable, useDroppable, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { usePlayers, useRatingContext, useSaveRoster, useSettings } from '../../api/hooks';
import type { Player, RosterPlayer, SessionDetail, Team, TeamColor } from '../../api/types';
import { useAuth } from '../../auth/useAuth';
import { MiniCard } from '../../components/cards';
import { useCourtSensors, TeamBand, WinProbBar } from '../../components/Court';
import { IconLock, IconScale, IconShuffle } from '../../components/icons';
import { Button, EmptyState, SectionTitle, Sheet, errorMessage, translateCode, useToast } from '../../components/ui';
import { fmtNum, fmtSigned } from '../../i18n';
import { balanceTeams, type BalanceResult } from '../../lib/balance';
import { ZONE_GRID } from '../../lib/positions';
import { newGuid } from '../../lib/rng';
import { chemistryBonus, positionRating, teamRating, winProbability, type RatingContext, type Slot } from '../../lib/teamRating';
import { validateRoster } from '../../lib/validation';
import { displayName } from '../../lib/arabic';

type Assign = { teamId: string | null; position: number | null; isBench: boolean };
type DraftTeam = Pick<Team, 'id' | 'label' | 'color'>;
type Target = { kind: 'slot'; teamId: string; pos: number } | { kind: 'bench' } | { kind: 'pool' };

const COLORS: TeamColor[] = ['a', 'b', 'c', 'd'];

export default function TeamBuilderTab({ session }: { session: SessionDetail }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const toast = useToast();
  const auth = useAuth();
  const players = usePlayers();
  const { settings } = useSettings();
  const { ctx } = useRatingContext();
  const save = useSaveRoster(session.id);
  const sensors = useCourtSensors();
  const template = settings.positionTemplate;
  const size = template.length;
  const editable = auth.canEditSession(session.status);

  const [draft, setDraft] = useState(() => initialDraft(session, size, t));
  const [selected, setSelected] = useState<string | null>(null);
  const [locks, setLocks] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [preview, setPreview] = useState<BalanceResult | null>(null);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6));
  const [dirty, setDirty] = useState(false);

  const playerMap = useMemo(() => new Map((players.data ?? []).map((p) => [p.id, p])), [players.data]);
  const slotsOf = (teamId: string) => {
    const m: Record<number, string> = {};
    for (const [pid, a] of Object.entries(draft.a)) if (a.teamId === teamId && !a.isBench && a.position) m[a.position] = pid;
    return m;
  };
  const toSlots = (m: Record<number, string>): Slot[] => Object.entries(m).map(([pos, id]) => ({ playerId: id, position: Number(pos) }));
  const benchIds = Object.entries(draft.a).filter(([, a]) => a.isBench).map(([id]) => id);
  const poolIds = Object.entries(draft.a).filter(([, a]) => !a.isBench && (!a.teamId || !a.position)).map(([id]) => id);
  const activeIds = Object.entries(draft.a).filter(([, a]) => !a.isBench).map(([id]) => id);
  const ratings = draft.teams.map((tm) => teamRating(ctx, toSlots(slotsOf(tm.id))));
  const complete = draft.teams.every((tm) => Object.keys(slotsOf(tm.id)).length === size);
  const spread = ratings.length ? Math.max(...ratings) - Math.min(...ratings) : 0;

  const locate = (pid: string): Target => {
    const a = draft.a[pid];
    if (a.isBench) return { kind: 'bench' };
    if (a.teamId && a.position) return { kind: 'slot', teamId: a.teamId, pos: a.position };
    return { kind: 'pool' };
  };

  /** Move a player to a target; whoever was there takes the mover's old place (swap). */
  const move = (pid: string, target: Target) => {
    if (!editable) return;
    setDraft((d) => {
      const a = { ...d.a };
      const src = a[pid];
      if (target.kind === 'slot') {
        const occupant = Object.entries(a).find(([id, x]) => id !== pid && x.teamId === target.teamId && x.position === target.pos && !x.isBench)?.[0];
        a[pid] = { teamId: target.teamId, position: target.pos, isBench: false };
        if (occupant) a[occupant] = src.isBench ? { teamId: target.teamId, position: null, isBench: true } : { ...src };
      } else if (target.kind === 'bench') {
        a[pid] = { teamId: src.teamId, position: null, isBench: true };
      } else {
        a[pid] = { teamId: null, position: null, isBench: false };
      }
      return { ...d, a };
    });
    setDirty(true);
  };

  const onTap = (pid: string | undefined, target: Target) => {
    if (!editable) return;
    if (!selected) {
      if (pid) setSelected(pid);
      return;
    }
    if (pid === selected) return setSelected(null);
    if (target.kind === 'slot') move(selected, target);
    else if (pid) {
      const selTarget = locate(selected);
      if (selTarget.kind === 'slot') move(pid, selTarget);
      else setSelected(pid);
      if (selTarget.kind !== 'slot') return;
    } else move(selected, target);
    setSelected(null);
  };

  const onDragStart = (e: DragStartEvent) => {
    setDragId(String(e.active.id));
    setSelected(null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    if (!e.over) return;
    const pid = String(e.active.id).split(':')[1];
    const [kind, teamId, pos] = String(e.over.id).split(':');
    if (kind === 'slot') move(pid, { kind: 'slot', teamId, pos: Number(pos) });
    else if (kind === 'bench') move(pid, { kind: 'bench' });
    else if (kind === 'pool') move(pid, { kind: 'pool' });
  };

  const runBalance = (s: number) => {
    const teamIndex = new Map(draft.teams.map((tm, i) => [tm.id, i]));
    const lockMap: Record<string, number> = {};
    for (const id of locks) {
      const tid = draft.a[id]?.teamId;
      if (tid && !draft.a[id].isBench && teamIndex.has(tid)) lockMap[id] = teamIndex.get(tid)!;
    }
    const preferred = Object.fromEntries(activeIds.map((id) => [id, playerMap.get(id)?.preferredPosition ?? 4]));
    setPreview(balanceTeams(ctx, { playerIds: activeIds, teamCount: draft.teams.length, template, locks: lockMap, preferred, seed: s }));
  };

  const acceptPreview = () => {
    if (!preview) return;
    setDraft((d) => {
      const a = { ...d.a };
      preview.teams.forEach((team, i) => team.forEach((sl) => (a[sl.playerId] = { teamId: d.teams[i].id, position: sl.position, isBench: false })));
      return { ...d, a };
    });
    setPreview(null);
    setDirty(true);
  };

  const submit = () => {
    const roster: RosterPlayer[] = Object.entries(draft.a).map(([playerId, a], i) => ({
      playerId,
      teamId: a.isBench ? (a.teamId ?? draft.teams[i % draft.teams.length]?.id ?? null) : a.teamId,
      position: a.isBench ? null : a.position,
      isBench: a.isBench,
    }));
    const errs = validateRoster(draft.teams, roster, settings);
    if (errs.length) return toast(translateCode(errs[0].code, errs[0].params, t), 'error');
    save.mutate(
      { teams: draft.teams, players: roster },
      {
        onSuccess: () => {
          setDirty(false);
          toast(t('common.saved'));
          nav(`/sessions/${session.id}/games`);
        },
        onError: (e) => toast(errorMessage(e, t), 'error'),
      },
    );
  };

  if (!draft.teams.length)
    return (
      <div className="page">
        <EmptyState title={t('builder.needCheckin', { n: Math.min(...settings.allowedTeamCounts) * size })} action={<Button onClick={() => nav(`/sessions/${session.id}/checkin`)}>{t('sessions.tabs.checkin')}</Button>} />
      </div>
    );

  const activeDrag = dragId?.split(':')[1];
  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
      <div className="page">
        {/* Ratings strip */}
        <div className="mb-2 grid gap-2" style={{ gridTemplateColumns: `repeat(${draft.teams.length}, minmax(0, 1fr))` }}>
          {draft.teams.map((tm, i) => (
            <div key={tm.id} className={`card-panel flex items-center justify-between gap-1 px-2 py-1 border-s-4`} style={{ borderColor: `var(--team-${tm.color})` }}>
              <span className="truncate font-display text-[16px] font-extrabold" style={{ color: `var(--team-${tm.color}-line)` }}>{tm.label}</span>
              <span className="num text-[22px] font-extrabold">{fmtNum(Math.round(ratings[i]))}</span>
            </div>
          ))}
        </div>
        {complete && (
          <div className={`mb-3 flex items-center gap-2 px-3 py-2 font-display text-[15px] font-bold ${spread <= 2 ? 'bg-cyan text-on-cyan' : 'bg-warn-bg text-warn'}`}>
            <IconScale size={18} />
            {spread <= 2 ? t('builder.balanced', { spread: fmtNum(spread, { maximumFractionDigits: 1 }) }) : t('builder.unbalanced', { spread: fmtNum(spread, { maximumFractionDigits: 1 }) })}
          </div>
        )}
        {editable && <p className="mb-3 text-small text-fg-2">{t('builder.tapToSwap')}</p>}

        <div className="grid gap-4 lg:grid-cols-3">
          {draft.teams.map((tm, i) => {
            const slots = slotsOf(tm.id);
            const chem = chemistryBonus(ctx, Object.values(slots));
            return (
              <section key={tm.id} className="card-panel overflow-hidden">
                <TeamBand
                  color={tm.color}
                  label={tm.label}
                  rating={ratings[i]}
                  extra={<span className="text-caption font-bold opacity-90">{t('team.chemistry', { value: fmtSigned(chem, 1) })}</span>}
                />
                <div dir="ltr" className="grid grid-cols-3 justify-items-center gap-y-3 px-2 py-3">
                  {[[4, 3, 2], [5, 6, 1]].flat().filter((p) => template.includes(p)).map((pos) => (
                    <SlotCell
                      key={pos}
                      id={`slot:${tm.id}:${pos}`}
                      pos={pos}
                      row={ZONE_GRID[pos].row}
                      playerId={slots[pos]}
                      player={slots[pos] ? playerMap.get(slots[pos]) : undefined}
                      color={tm.color}
                      ctx={ctx}
                      selected={selected === slots[pos]}
                      locked={!!slots[pos] && locks.has(slots[pos])}
                      dragging={activeDrag === slots[pos]}
                      editable={editable}
                      onTap={() => onTap(slots[pos], { kind: 'slot', teamId: tm.id, pos })}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {poolIds.length > 0 && (
          <DropArea id="pool" title={t('builder.unassigned')}>
            {poolIds.map((id) => (
              <ListCard key={id} id={`pool:${id}`} player={playerMap.get(id)} ctx={ctx} selected={selected === id} dragging={activeDrag === id} editable={editable} onTap={() => onTap(id, { kind: 'pool' })} />
            ))}
          </DropArea>
        )}

        <DropArea id="bench" title={t('team.bench')} hint={editable ? t('builder.benchHint') : undefined}>
          {benchIds.length === 0 ? (
            <span className="text-small text-fg-3">{t('count.bench', { count: 0 })}</span>
          ) : (
            benchIds.map((id) => (
              <ListCard key={id} id={`bench:${id}`} player={playerMap.get(id)} ctx={ctx} benched selected={selected === id} dragging={activeDrag === id} editable={editable} onTap={() => onTap(id, { kind: 'bench' })} />
            ))
          )}
        </DropArea>

        {complete && draft.teams.length > 1 && (
          <>
            <SectionTitle>{t('builder.matchups')}</SectionTitle>
            <div className="card-panel flex flex-col gap-3 p-3">
              {pairs(draft.teams.length).map(([x, y]) => (
                <WinProbBar key={`${x}-${y}`} pA={winProbability(ratings[x], ratings[y], size)} colorA={draft.teams[x].color} colorB={draft.teams[y].color} labelA={draft.teams[x].label} labelB={draft.teams[y].label} />
              ))}
            </div>
          </>
        )}
      </div>

      <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(.34,1.3,.64,1)' }}>
        {activeDrag ? <MiniCard player={playerMap.get(activeDrag)} stats={ctx.stats.get(activeDrag)} settings={settings} team={teamColor(draft, activeDrag)} dragging /> : null}
      </DragOverlay>

      {editable && (
        <div className="action-bar">
          {selected && locate(selected).kind === 'slot' ? (
            <Button
              onClick={() => {
                setLocks((l) => {
                  const n = new Set(l);
                  if (n.has(selected)) n.delete(selected);
                  else n.add(selected);
                  return n;
                });
                setSelected(null);
              }}
            >
              <IconLock size={18} /> {locks.has(selected) ? t('builder.unlock') : t('builder.lock')}
            </Button>
          ) : (
            <Button onClick={() => { const s = seed + 1; setSeed(s); runBalance(s); }} disabled={activeIds.length !== draft.teams.length * size}>
              <IconShuffle size={18} /> {t('builder.shuffle')}
            </Button>
          )}
          <Button variant="ink" onClick={() => runBalance(seed)} disabled={activeIds.length !== draft.teams.length * size}>
            <IconScale size={18} /> {t('builder.autoBalance')}
          </Button>
          <Button variant="primary" onClick={submit} disabled={save.isPending || (!dirty && session.teams.length > 0)}>
            {t('builder.save')}
          </Button>
        </div>
      )}

      <Sheet
        open={!!preview}
        onClose={() => setPreview(null)}
        title={t('builder.previewTitle')}
        footer={
          <>
            <Button onClick={() => { const s = seed + 1; setSeed(s); runBalance(s); }}>
              <IconShuffle size={18} /> {t('builder.shuffle')}
            </Button>
            <Button variant="primary" onClick={acceptPreview}>{t('builder.accept')}</Button>
          </>
        }
      >
        {preview && (
          <div className="flex flex-col gap-3">
            <div className="bg-cyan px-3 py-2 font-display font-bold text-on-cyan">
              {t('builder.balanced', { spread: fmtNum(preview.spread, { maximumFractionDigits: 1 }) })}
            </div>
            {preview.teams.map((team, i) => (
              <div key={i} className="border border-line">
                <TeamBand color={draft.teams[i].color} label={draft.teams[i].label} rating={preview.ratings[i]} />
                <ul className="grid grid-cols-2 gap-x-3 gap-y-1 p-2 text-small sm:grid-cols-3">
                  {team.map((sl) => (
                    <li key={sl.playerId} className="flex items-center gap-1">
                      <span className="num w-5 bg-ink text-center font-bold text-on-ink">{fmtNum(sl.position)}</span>
                      <span className="truncate">{displayName(playerMap.get(sl.playerId)?.name ?? '')}</span>
                      {locks.has(sl.playerId) && <IconLock size={12} />}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {preview.teams.length > 1 &&
              pairs(preview.teams.length).map(([x, y]) => (
                <WinProbBar key={`${x}-${y}`} pA={winProbability(preview.ratings[x], preview.ratings[y], size)} colorA={draft.teams[x].color} colorB={draft.teams[y].color} labelA={draft.teams[x].label} labelB={draft.teams[y].label} />
              ))}
          </div>
        )}
      </Sheet>
    </DndContext>
  );
}

function initialDraft(session: SessionDetail, size: number, t: (k: string) => string) {
  if (session.teams.length) {
    const a: Record<string, Assign> = {};
    for (const p of session.players) a[p.playerId] = { teamId: p.teamId, position: p.position, isBench: p.isBench };
    return { teams: session.teams.map(({ id, label, color }) => ({ id, label, color })) as DraftTeam[], a };
  }
  const active = session.players.filter((p) => !p.isBench);
  const count = Math.floor(active.length / size);
  const teams: DraftTeam[] = active.length % size === 0 && count >= 2 ? COLORS.slice(0, count).map((c) => ({ id: newGuid(), label: t(`team.${c}`), color: c })) : [];
  const a: Record<string, Assign> = {};
  for (const p of session.players) a[p.playerId] = { teamId: null, position: null, isBench: p.isBench };
  return { teams, a };
}

function teamColor(d: { teams: DraftTeam[]; a: Record<string, Assign> }, pid: string): TeamColor | null {
  const tid = d.a[pid]?.teamId;
  return d.teams.find((x) => x.id === tid)?.color ?? null;
}

const pairs = (n: number) => {
  const r: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) r.push([i, j]);
  return r;
};

function SlotCell({ id, pos, playerId, player, color, ctx, selected, locked, dragging, editable, onTap }: {
  id: string; pos: number; row: number; playerId?: string; player?: Player; color: TeamColor; ctx: RatingContext; selected: boolean; locked: boolean; dragging: boolean; editable: boolean; onTap: () => void;
}) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !editable });
  return (
    <div ref={setNodeRef} className="relative">
      {playerId ? (
        <Draggable id={`p:${playerId}`} disabled={!editable}>
          <button type="button" onClick={onTap} aria-pressed={selected} aria-label={`${player?.name} · ${t(`pos.${pos}`)}`} className={isOver ? 'outline-dashed outline-2 outline-brand' : ''}>
            <MiniCard
              player={player}
              stats={ctx.stats.get(playerId)}
              settings={ctx.settings}
              team={color}
              position={pos}
              rating={positionRating(ctx, playerId, pos)}
              selected={selected}
              className={dragging ? 'opacity-30' : ''}
              badge={locked ? <span className="absolute -end-1 -top-1 bg-ink p-0.5 text-on-ink"><IconLock size={12} /></span> : null}
            />
          </button>
        </Draggable>
      ) : (
        <button type="button" onClick={onTap} className={`slot flex flex-col items-center justify-center text-caption font-bold text-fg-3 ${isOver ? 'is-target' : ''}`}>
          <span className="num text-[18px]">{fmtNum(pos)}</span>
          {isOver ? t('builder.dropHere') : t('builder.emptySlot')}
        </button>
      )}
    </div>
  );
}

function Draggable({ id, disabled, children }: { id: string; disabled?: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id, disabled });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} role="presentation">
      {children}
    </div>
  );
}

function DropArea({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef} className={`card-panel mt-4 p-3 ${isOver ? 'outline-dashed outline-2 outline-brand' : ''}`}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-display text-h3 font-extrabold">{title}</h3>
        {hint && <span className="text-caption text-fg-3">{hint}</span>}
      </div>
      <div className="flex flex-wrap gap-3">{children}</div>
    </section>
  );
}

function ListCard({ id, player, ctx, benched, selected, dragging, editable, onTap }: { id: string; player?: Player; ctx: RatingContext; benched?: boolean; selected: boolean; dragging: boolean; editable: boolean; onTap: () => void }) {
  const pid = id.split(':')[1];
  return (
    <Draggable id={`p:${pid}`} disabled={!editable}>
      <button type="button" onClick={onTap} aria-pressed={selected} aria-label={player?.name}>
        <MiniCard player={player} stats={ctx.stats.get(pid)} settings={ctx.settings} benched={benched} selected={selected} className={dragging ? 'opacity-30' : ''} />
      </button>
    </Draggable>
  );
}
