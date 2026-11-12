import { useDraggable, useDroppable, MouseSensor, TouchSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import type { GroupSettings, Player, PlayerStats, TeamColor } from '../api/types';
import { fmtPct, fmtSigned } from '../i18n';
import { ZONE_GRID, ZONE_LINKS } from '../lib/positions';
import { pairChemistry, positionRating, type RatingContext } from '../lib/teamRating';
import { MiniCard } from './cards';

export type CourtSide = 'top' | 'bottom';
export interface CourtTeam {
  color: TeamColor;
  /** position → playerId */
  slots: Record<number, string | undefined>;
  /** positions whose player differs from the base lineup */
  changed?: Set<number>;
}

/** Drag ids: "slot:<side>:<pos>" for court slots, "bench:<playerId>" for bench cards. */
export const slotId = (side: CourtSide, pos: number) => `slot:${side}:${pos}`;
export function parseDragId(id: string): { kind: 'slot'; side: CourtSide; pos: number } | { kind: 'bench'; playerId: string } | null {
  const [kind, a, b] = id.split(':');
  if (kind === 'slot') return { kind, side: a as CourtSide, pos: Number(b) };
  if (kind === 'bench') return { kind, playerId: a };
  return null;
}

/** Long-press 250 ms on touch, 8 px drag with a mouse — as in the court spec. */
export function useCourtSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
}

const W = 360;
const H = 540;
const COLS = [W / 6, W / 2, (5 * W) / 6];

/**
 * Where a zone's card centre sits on screen. Bottom team faces up (its left = screen left):
 * front row 4·3·2 just below the net. Top team faces down, so its layout is rotated 180°.
 * The court is a place: it never mirrors in RTL (rendered inside dir="ltr").
 */
export function zoneCenter(side: CourtSide, pos: number) {
  const { col, row } = ZONE_GRID[pos];
  const half = H / 2;
  if (side === 'bottom') return { x: COLS[col], y: half + (row === 0 ? half / 4 : (3 * half) / 4) };
  return { x: COLS[2 - col], y: row === 0 ? (3 * half) / 4 : half / 4 };
}

interface CourtProps {
  top: CourtTeam;
  bottom: CourtTeam;
  players: Map<string, Player>;
  stats: Map<string, PlayerStats>;
  ctx: RatingContext;
  settings: GroupSettings;
  template: number[];
  showChemistry?: boolean;
  mvpId?: string | null;
  selected?: string | null;
  editable?: boolean;
  activeDragId?: string | null;
  onTapSlot?: (side: CourtSide, pos: number, playerId: string | undefined) => void;
  /** Show only the bottom half (e.g. the dream team). */
  single?: boolean;
}

export function Court({ top, bottom, players, stats, ctx, settings, template, showChemistry, mvpId, selected, editable, activeDragId, onTapSlot, single }: CourtProps) {
  const { t } = useTranslation();
  const sides: [CourtSide, CourtTeam][] = single ? [['bottom', bottom]] : [['top', top], ['bottom', bottom]];
  const y0 = single ? H / 2 - 24 : 0;
  const vh = H - y0;
  const left = (x: number) => `${(x / W) * 100}%`;
  const topPct = (y: number) => `${((y - y0) / vh) * 100}%`;

  return (
    <div dir="ltr" className="relative mx-auto w-full max-w-[400px] select-none" style={{ aspectRatio: `${W} / ${vh}` }}>
      <svg viewBox={`0 ${y0} ${W} ${vh}`} className="absolute inset-0 h-full w-full" role="img" aria-label={t('game.court')}>
        <rect x="0" y="0" width={W} height={H} fill="var(--court-out)" />
        <rect x="8" y="8" width={W - 16} height={H - 16} fill="var(--court)" />
        {/* attack-line bands: darker so front/back rows read at a glance */}
        <rect x="8" y={H / 2 - H / 6} width={W - 16} height={H / 3} fill="var(--court-2)" />
        <g stroke="var(--court-line)" strokeWidth="3" fill="none">
          <rect x="8" y="8" width={W - 16} height={H - 16} />
          <line x1="8" y1={H / 2 - H / 6} x2={W - 8} y2={H / 2 - H / 6} />
          <line x1="8" y1={H / 2 + H / 6} x2={W - 8} y2={H / 2 + H / 6} />
        </g>
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="var(--net)" strokeWidth="5" />
        <circle cx="4" cy={H / 2} r="4" fill="var(--net)" />
        <circle cx={W - 4} cy={H / 2} r="4" fill="var(--net)" />

        {showChemistry && !activeDragId &&
          sides.map(([side, team]) =>
            ZONE_LINKS.filter(([a, b]) => team.slots[a] && team.slots[b]).map(([a, b]) => {
              const chem = pairChemistry(ctx, team.slots[a]!, team.slots[b]!);
              const p1 = zoneCenter(side, a);
              const p2 = zoneCenter(side, b);
              const style = chemStyle(chem);
              return (
                <g key={`${side}-${a}-${b}`}>
                  <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#121218" strokeOpacity=".5" strokeWidth={style.width + 2} strokeLinecap="round" />
                  <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={style.color} strokeWidth={style.width} strokeDasharray={style.dash} strokeLinecap="round">
                    <title>{chem === null ? t('common.notEnoughData') : fmtSigned(chem * 20, 1)}</title>
                  </line>
                </g>
              );
            }),
          )}
      </svg>

      {/* Layer 1: drop targets (and tappable empty slots). */}
      {sides.map(([side, team]) =>
        template.map((pos) => {
          const c = zoneCenter(side, pos);
          return (
            <Slot key={slotId(side, pos)} id={slotId(side, pos)} left={left(c.x)} top={topPct(c.y)} editable={!!editable} empty={!team.slots[pos]} onTap={() => onTapSlot?.(side, pos, undefined)} label={t(`pos.${pos}`)} />
          );
        }),
      )}

      {/* Layer 2: cards, keyed by player so a swap animates them across the court. */}
      {sides.flatMap(([side, team]) =>
        template
          .filter((pos) => team.slots[pos])
          .map((pos) => {
            const id = slotId(side, pos);
            const playerId = team.slots[pos]!;
            const c = zoneCenter(side, pos);
            const player = players.get(playerId);
            return (
              <div
                key={playerId}
                className="pointer-events-none absolute transition-[left,top] duration-[var(--dur-swap)] ease-standard"
                style={{ left: left(c.x), top: topPct(c.y), transform: 'translate(-50%, -50%)', zIndex: activeDragId === id ? 40 : 10 }}
              >
                <DraggableCard id={id} disabled={!editable}>
                  <button
                    type="button"
                    className="pointer-events-auto block"
                    onClick={() => onTapSlot?.(side, pos, playerId)}
                    aria-label={`${player?.name ?? ''} · ${t(`pos.${pos}`)}`}
                    aria-pressed={selected === playerId || mvpId === playerId}
                  >
                    <MiniCard
                      player={player}
                      stats={stats.get(playerId)}
                      settings={settings}
                      team={team.color}
                      position={pos}
                      rating={positionRating(ctx, playerId, pos)}
                      isMvp={mvpId === playerId}
                      selected={selected === playerId}
                      dragging={activeDragId === id}
                      badge={team.changed?.has(pos) ? <span className="absolute -end-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-cyan" /> : null}
                    />
                  </button>
                </DraggableCard>
              </div>
            );
          }),
      )}
    </div>
  );
}

function Slot({ id, left, top, editable, empty, onTap, label }: { id: string; left: string; top: string; editable: boolean; empty: boolean; onTap: () => void; label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !editable });
  return (
    <div
      ref={setNodeRef}
      className={`absolute flex items-center justify-center ${isOver ? 'outline-dashed outline-2 outline-brand' : ''}`}
      style={{ left, top, width: 76, height: 96, transform: 'translate(-50%, -50%)', background: isOver ? 'var(--brand-soft)' : undefined }}
    >
      {empty && <button type="button" onClick={onTap} className={`slot ${isOver ? 'is-target' : ''}`} aria-label={label} />}
    </div>
  );
}

export function DraggableCard({ id, disabled, children }: { id: string; disabled?: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="presentation"
      style={{ transform: CSS.Translate.toString(transform), zIndex: isDragging ? 40 : undefined, touchAction: disabled ? undefined : 'manipulation' }}
    >
      {children}
    </div>
  );
}

/** Chemistry line style: colour + weight + dash (negative is always dashed). */
export function chemStyle(chem: number | null) {
  if (chem === null) return { color: 'var(--chem-neutral)', width: 1.5, dash: '2 5' };
  const pts = chem * 20;
  if (pts >= 2) return { color: 'var(--chem-pos-strong)', width: 6, dash: undefined };
  if (pts >= 0.5) return { color: 'var(--chem-pos)', width: 4, dash: undefined };
  if (pts > -0.5) return { color: 'var(--chem-neutral)', width: 2, dash: undefined };
  if (pts > -2) return { color: 'var(--chem-neg)', width: 3, dash: '6 5' };
  return { color: 'var(--chem-neg-strong)', width: 5, dash: '6 5' };
}

export function TeamBand({ color, label, rating, align = 'start', extra }: { color: TeamColor; label: string; rating?: number; align?: 'start' | 'end'; extra?: React.ReactNode }) {
  return (
    <div className={`team-${color} flex min-h-[44px] items-center gap-2 px-3 pat-${color} ${align === 'end' ? 'flex-row-reverse' : ''}`} style={{ background: 'var(--team)', color: 'var(--on-team)' }}>
      <span className="flex-1 truncate font-display text-[20px] font-extrabold">{label}</span>
      {extra}
      {rating !== undefined && <span className="num text-[24px] font-extrabold">{Math.round(rating)}</span>}
    </div>
  );
}

export function WinProbBar({ pA, colorA, colorB, labelA, labelB }: { pA: number; colorA: TeamColor; colorB: TeamColor; labelA: string; labelB: string }) {
  const { t } = useTranslation();
  const a = Math.round(pA * 100);
  return (
    <div className="flex flex-col gap-1" aria-label={`${t('game.winProb')}: ${labelA} ${a}%, ${labelB} ${100 - a}%`}>
      <div className="flex justify-between text-caption font-bold">
        <span style={{ color: `var(--team-${colorA}-line)` }}>{labelA} <span className="num">{fmtPct(a / 100)}</span></span>
        <span className="text-fg-3">{t('game.winProb')}</span>
        <span style={{ color: `var(--team-${colorB}-line)` }}>{labelB} <span className="num">{fmtPct(1 - a / 100)}</span></span>
      </div>
      <div className="flex h-2 overflow-hidden bg-surface-3">
        <div style={{ width: `${a}%`, background: `var(--team-${colorA})` }} className="transition-[width] duration-300" />
        <div style={{ width: `${100 - a}%`, background: `var(--team-${colorB})` }} className="transition-[width] duration-300" />
      </div>
    </div>
  );
}
