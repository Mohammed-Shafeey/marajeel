import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Team } from '../api/types';
import { fmtNum } from '../i18n';
import { IconMinus, IconSwap, IconX } from './icons';

type SetScore = React.Dispatch<React.SetStateAction<number>>;

/**
 * Courtside scoreboard: each team fills half the screen in its colour (stacked in portrait, side by side in
 * landscape); tap a half to add a point.
 * "Swap sides" mirrors the halves so each team's score sits on its side of the net after a change of ends.
 * Uses the Fullscreen API where available (not on iPhone) and keeps the screen awake while open.
 */
export function ScoreFullscreen({
  teamA,
  teamB,
  scoreA,
  scoreB,
  setScoreA,
  setScoreB,
  onClose,
}: {
  teamA: Team;
  teamB: Team;
  scoreA: number;
  scoreB: number;
  setScoreA: SetScore;
  setScoreB: SetScore;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [swapped, setSwapped] = useState(false);
  // The parent passes a fresh onClose each render; keep the effect below from re-running (and leaving fullscreen) on every point.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) void el.requestFullscreen().catch(() => {});
    let lock: WakeLockSentinel | null = null;
    void navigator.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {});
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
      void lock?.release().catch(() => {});
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  const halves = [
    { team: teamA, score: scoreA, set: setScoreA },
    { team: teamB, score: scoreB, set: setScoreB },
  ];
  if (swapped) halves.reverse();
  const clamp = (v: number) => Math.max(0, Math.min(99, v));

  return (
    <div className="fixed inset-0 z-[70] flex select-none flex-col bg-black landscape:flex-row" dir="ltr" role="dialog" aria-modal="true" aria-label={t('game.scoreboard')}>
      {halves.map(({ team, score, set }) => (
        <div key={team.id} className={`team-${team.color} pat-${team.color} relative flex flex-1 flex-col portrait:pt-8`} style={{ background: 'var(--team)', color: 'var(--on-team)' }}>
          <button
            type="button"
            className="flex flex-1 flex-col items-center justify-center gap-2 active:brightness-110"
            aria-label={t('game.increase', { team: team.label })}
            onClick={() => set((v) => clamp(v + 1))}
          >
            <span className="font-display text-[clamp(22px,5vw,44px)] font-extrabold" dir="auto">{team.label}</span>
            <span key={score} className="score-tick num font-extrabold leading-none" style={{ fontSize: 'min(60vmin, 28vmax)' }}>
              {fmtNum(score)}
            </span>
          </button>
          <button
            type="button"
            className="mx-auto mb-[max(16px,env(safe-area-inset-bottom))] flex h-14 w-20 portrait:mb-10 items-center justify-center bg-black/25 disabled:opacity-40"
            aria-label={t('game.decrease', { team: team.label })}
            disabled={score <= 0}
            onClick={() => set((v) => clamp(v - 1))}
          >
            <IconMinus size={30} />
          </button>
        </div>
      ))}

      <div className="pointer-events-none absolute inset-x-0 flex justify-center gap-2 portrait:top-1/2 portrait:-translate-y-1/2 landscape:top-[max(12px,env(safe-area-inset-top))]">
        <button type="button" className="pointer-events-auto flex h-12 items-center gap-2 bg-black/70 px-4 font-display font-bold text-white" onClick={() => setSwapped((s) => !s)}>
          <IconSwap size={20} /> {t('game.swapSides')}
        </button>
        <button type="button" className="pointer-events-auto flex h-12 w-12 items-center justify-center bg-black/70 text-white" aria-label={t('common.close')} onClick={onClose}>
          <IconX size={22} />
        </button>
      </div>
    </div>
  );
}
