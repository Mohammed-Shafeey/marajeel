import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { GroupSettings, Player, PlayerStats, TeamColor } from '../api/types';
import { fmtNum, fmtPct } from '../i18n';
import { cardName } from '../lib/arabic';
import { isHitting, isReceiving } from '../lib/positions';
import { tierOf } from '../lib/teamRating';
import { IconCheck } from './icons';

export function Num({ n, className = '' }: { n: number; className?: string }) {
  return <span className={`num ${className}`}>{fmtNum(n)}</span>;
}

type Tier = 'gold' | 'silver' | 'bronze' | 'prov' | 'mvp';

export function cardTier(stats: PlayerStats | undefined, settings: GroupSettings, isMvp = false): Tier {
  if (isMvp && stats && !stats.provisional) return 'mvp';
  return tierOf(stats?.rating ?? 0, stats?.provisional ?? true, settings);
}

function TeamShape({ color }: { color?: TeamColor | null }) {
  const shape = { a: '●', b: '▲', c: '■', d: '◆' }[color ?? 'a'];
  return <span aria-hidden="true" className="text-[11px] leading-none">{color ? shape : ''}</span>;
}

/** Best rating among positions of one kind (only those actually played). */
function kindRating(stats: PlayerStats | undefined, pred: (p: number) => boolean): number | null {
  const ps = stats?.positions.filter((p) => pred(p.position) && p.games > 0) ?? [];
  return ps.length ? Math.max(...ps.map((p) => p.rating)) : null;
}

export interface PlayerCardProps {
  player: Player;
  stats?: PlayerStats;
  settings: GroupSettings;
  team?: TeamColor | null;
  isMvp?: boolean;
  selected?: boolean;
  benched?: boolean;
  className?: string;
}

/** Full FUT-style collectible card, 200 × 300. */
export function PlayerCard({ player, stats, settings, team, isMvp, selected, benched, className = '' }: PlayerCardProps) {
  const { t } = useTranslation();
  const tier = cardTier(stats, settings, isMvp);
  const pos = stats?.bestPosition ?? player.preferredPosition;
  const hitting = kindRating(stats, isHitting);
  const receiving = kindRating(stats, isReceiving);
  const setting = kindRating(stats, (p) => p === 3);
  const isSetter = pos === 3;
  const totalGames = stats ? stats.positions.reduce((s, p) => s + p.games, 0) : 0;
  const ribbon = !player.isActive
    ? t('card.inactive')
    : benched
      ? t('card.benched')
      : stats?.provisional !== false
        ? t('card.provisional', { n: Math.min(totalGames, settings.provisionalGames), of: settings.provisionalGames })
        : null;
  const ribbonCls = !player.isActive ? 'bg-[#5E5D66] text-white' : benched ? 'bg-ink text-on-ink' : 'bg-cyan text-on-cyan';

  return (
    <div
      className={`cw tier-${tier} team-${team ?? 'none'} ${selected ? 'is-selected' : ''} ${benched ? 'is-benched' : ''} ${!player.isActive ? 'is-inactive' : ''} ${className}`}
      aria-label={`${player.name} · ${t('common.rating')} ${stats?.rating ?? '—'}`}
    >
      <div className="fut">
        <div className="fut-in">
          <div className="fut-photo" style={{ background: 'transparent', color: 'var(--on)' }}>
            {player.photoUrl ? <img draggable={false} src={player.photoUrl} alt="" loading="lazy" /> : <Silhouette className="fut-sil" />}
          </div>
          <div className="fut-side">
            <span className="fut-ovr num">{stats ? fmtNum(stats.rating) : '—'}</span>
            <span className="fut-pos">{t(`pos.short.${pos}`)}</span>
            <span className="fut-rule" />
            <span className="fut-badge"><TeamShape color={team} /></span>
            {isMvp && <span className="font-display text-[13px] font-extrabold">MVP</span>}
          </div>
          {ribbon && <div className={`fut-ribbon ${ribbonCls}`}>{ribbon}</div>}
          <div className="fut-name">{cardName(player.name, player.shortName)}</div>
          <div className="fut-stats">
            <Stat v={stats ? fmtNum(stats.games) : '—'} l={t('card.games')} />
            <Stat v={stats && stats.games ? fmtNum(Math.round(stats.winPct * 100)) : '—'} l={t('card.winPct')} />
            <Stat v={stats ? fmtNum(stats.currentStreak) : '—'} l={t('card.streak')} />
            <Stat v={stats ? fmtNum(stats.mvps) : '—'} l={t('card.mvp')} />
            {isSetter ? (
              <Stat v={setting !== null ? fmtNum(setting) : '—'} l={t('card.setting')} />
            ) : (
              <Stat v={hitting !== null ? fmtNum(hitting) : '—'} l={t('card.hitting')} />
            )}
            <Stat v={receiving !== null ? fmtNum(receiving) : '—'} l={t('card.receiving')} />
          </div>
          {selected && (
            <div className="fut-check">
              <IconCheck size={16} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ v, l }: { v: string; l: string }) {
  return (
    <div className="fut-stat">
      <b>{v}</b>
      <span>{l}</span>
    </div>
  );
}

export interface MiniCardProps extends HTMLAttributes<HTMLDivElement> {
  player: Player | undefined;
  stats?: PlayerStats;
  settings: GroupSettings;
  team?: TeamColor | null;
  position?: number | null;
  rating?: number;
  isMvp?: boolean;
  selected?: boolean;
  dragging?: boolean;
  benched?: boolean;
  badge?: ReactNode;
}

/**
 * 72 × 92 shield in the player's tier colours (gold / silver / bronze / MVP / provisional), like the full card,
 * with the team as the accent: team-coloured frame and name strip (card name). Rating + zone at inline-start,
 * photo or silhouette at inline-end.
 */
export const MiniCard = forwardRef<HTMLDivElement, MiniCardProps>(function MiniCard(
  { player, stats, settings, team, position, rating, isMvp, selected, dragging, benched, badge, className = '', ...rest },
  ref,
) {
  const { t } = useTranslation();
  const tier = cardTier(stats, settings, isMvp);
  const shown = rating ?? stats?.rating;
  const name = player?.name ?? t('common.unknownPlayer');
  return (
    <div
      ref={ref}
      className={`cw tier-${tier} team-${team ?? 'none'} ${selected ? 'is-selected' : ''} ${dragging ? 'is-dragging' : ''} ${benched ? 'is-benched' : ''} ${className}`}
      {...rest}
    >
      <div className="mini">
        <div className="mini-in">
          <span className="mini-ovr num">{shown !== undefined ? fmtNum(Math.round(shown)) : '—'}</span>
          {position ? <span className="mini-zone num">{fmtNum(position)}</span> : null}
          {player?.photoUrl ? (
            <img draggable={false} src={player.photoUrl} alt="" loading="lazy" className="absolute end-1 top-1 h-[44px] w-[36px] object-cover object-top" />
          ) : (
            <Silhouette className="mini-sil" />
          )}
          <span className={`mini-name ${team ? `pat-${team}` : ''}`}>{player ? cardName(player.name, player.shortName) : name}</span>
        </div>
      </div>
      {isMvp && (
        <span className="absolute -top-1 start-1/2 -translate-x-1/2 bg-volt px-1 font-display text-[11px] font-extrabold text-on-volt rtl:translate-x-1/2">MVP</span>
      )}
      {badge}
    </div>
  );
});

export function PositionChip({ position, best, compact }: { position: number; best?: boolean; compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-stretch overflow-hidden font-display text-[14px] font-bold ${best ? 'bg-brand text-on-brand' : 'bg-surface-2 text-fg'}`}
      aria-label={compact ? t(`pos.${position}`) : undefined}
    >
      <span className={`num flex min-w-[26px] items-center justify-center ${best ? 'bg-brand-strong' : 'bg-ink text-on-ink'}`}>{fmtNum(position)}</span>
      {!compact && <span className="flex items-center px-2">{t(`pos.${position}`)}{best ? ` · ${t('pos.best')}` : ''}</span>}
    </span>
  );
}

/** Photo or silhouette avatar for list rows. */
export function Avatar({ player, size = 40, team }: { player: Player | undefined; size?: number; team?: TeamColor | null }) {
  return (
    <span
      className={`inline-flex shrink-0 items-end justify-center overflow-hidden team-${team ?? 'none'}`}
      style={{ width: size, height: size, background: 'var(--team)', color: 'var(--on-team)', clipPath: 'polygon(12% 0, 100% 0, 100% 88%, 88% 100%, 0 100%, 0 12%)' }}
      aria-hidden="true"
    >
      {player?.photoUrl ? <img draggable={false} src={player.photoUrl} alt="" className="h-full w-full object-cover object-top" loading="lazy" /> : <Silhouette className="h-full w-full" />}
    </span>
  );
}

/** Generic head-and-shoulders placeholder for players without a photo; inherits the text colour. */
export function Silhouette({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMax meet" className={`silhouette ${className}`} aria-hidden="true" focusable="false">
      <circle cx="50" cy="38" r="21" />
      <path d="M8 100C8 75 26 64 50 64S92 75 92 100Z" />
    </svg>
  );
}

export function RatingDelta({ delta }: { delta: number }) {
  if (!delta) return null;
  return (
    <span className={`num text-small font-bold ${delta > 0 ? 'text-win' : 'text-loss'}`}>
      {delta > 0 ? '▲' : '▼'} {fmtNum(Math.abs(delta))}
    </span>
  );
}

export const pct = (x: number) => fmtPct(x);
