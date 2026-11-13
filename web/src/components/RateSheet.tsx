import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { GroupSettings, Player, PlayerStats } from '../api/types';
import { displayName } from '../lib/arabic';
import { PlayerCard } from './cards';
import { Button, Sheet } from './ui';

/** Levels top → bottom. 3 is the player's usual level, so the scale reads as "compared with themselves". */
const LEVELS = [5, 4, 3, 2, 1] as const;
const GLYPH: Record<number, string> = { 5: '▲▲', 4: '▲', 3: '●', 2: '▼', 1: '▼▼' };
const TONE: Record<number, string> = { 5: 'var(--win)', 4: 'var(--win)', 3: 'var(--text-2)', 2: 'var(--loss)', 1: 'var(--loss)' };

/**
 * Post-game prompt: the player's card beside a 5-step vertical slider that starts at "usual level" (3).
 * Sliding up or down says how this game compared with their normal level, not an absolute grade.
 */
export function RateSheet({
  player,
  stats,
  settings,
  busy,
  onSave,
  onSkip,
}: {
  player: Player | undefined;
  stats: PlayerStats | undefined;
  settings: GroupSettings;
  busy: boolean;
  onSave: (stars: number) => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const [level, setLevel] = useState(3);
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const fromPointer = (e: PointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    const f = Math.min(0.999, Math.max(0, (e.clientY - r.top) / r.height));
    setLevel(LEVELS[Math.floor(f * LEVELS.length)]);
  };
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
    if (d) {
      e.preventDefault();
      setLevel((l) => Math.min(5, Math.max(1, l + d)));
    } else if (e.key === 'Home') setLevel(1);
    else if (e.key === 'End') setLevel(5);
  };

  return (
    <Sheet
      open
      onClose={onSkip}
      title={t('rate.title')}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onSkip}>{t('rate.skip')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => onSave(level)}>{t('rate.save')}</Button>
        </>
      }
    >
      <p className="mb-3 text-center font-display text-h3 font-extrabold">{t('rate.question', { name: player ? displayName(player.name) : t('common.unknownPlayer') })}</p>
      <div className="flex items-stretch justify-center gap-3">
        {/* The card is drawn at 82 % (164 × 246); the outer box reserves exactly that so the slider gets the rest. */}
        <div className="relative h-[246px] w-[164px] shrink-0" style={{ filter: `drop-shadow(0 0 10px color-mix(in srgb, ${TONE[level]} 55%, transparent))` }}>
          <div className="absolute start-0 top-0 origin-top-left scale-[.82] rtl:origin-top-right">
            {player && <PlayerCard player={player} stats={stats} settings={settings} />}
          </div>
        </div>

        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label={t('rate.compared')}
          aria-valuemin={1}
          aria-valuemax={5}
          aria-valuenow={level}
          aria-valuetext={t(`rate.level.${level}`)}
          onKeyDown={onKey}
          onPointerDown={(e) => {
            dragging.current = true;
            (e.target as Element).setPointerCapture?.(e.pointerId);
            fromPointer(e);
          }}
          onPointerMove={(e) => dragging.current && fromPointer(e)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
          className="relative flex min-w-0 max-w-[200px] flex-1 cursor-pointer touch-none select-none flex-col"
          style={{ height: 246 }}
        >
          {/* Track: up = better than usual, middle = usual, down = worse. */}
          <span
            aria-hidden="true"
            className="absolute bottom-[24px] top-[24px] w-[6px] start-[13px]"
            style={{ background: 'linear-gradient(var(--win), var(--surface-3) 50%, var(--loss))' }}
          />
          {LEVELS.map((n) => {
            const on = n === level;
            return (
              <div key={n} className="relative flex flex-1 items-center gap-3">
                <span
                  aria-hidden="true"
                  className={`z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-black transition-transform ${on ? 'scale-110' : 'scale-75 opacity-70'}`}
                  style={{ borderColor: TONE[n], background: on ? TONE[n] : 'var(--surface)', color: on ? '#fff' : TONE[n] }}
                >
                  {GLYPH[n]}
                </span>
                <span className={`leading-tight transition-opacity ${on ? 'opacity-100' : 'opacity-55'}`}>
                  <span className="block whitespace-nowrap font-display text-[15px] font-extrabold" style={{ color: on ? TONE[n] : undefined }}>
                    {t(`rate.level.${n}`)}
                  </span>
                  {on && <span className="block text-caption text-fg-2">{t(`rate.levelHint.${n}`)}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-center text-small text-fg-2">{t('rate.hint')}</p>
    </Sheet>
  );
}
