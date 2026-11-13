import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePlayers, useRatingContext, useSettings } from '../api/hooks';
import { Court } from '../components/Court';
import { IconStar } from '../components/icons';
import { EmptyState, LoadingList, TopBar } from '../components/ui';
import { fmtNum, fmtSigned } from '../i18n';
import { dreamTeam } from '../lib/dreamTeam';
import { chemistryBonus } from '../lib/teamRating';
import { displayName } from '../lib/arabic';

export default function DreamTeamPage() {
  const { t } = useTranslation();
  const players = usePlayers();
  const { settings } = useSettings();
  const { ctx, isLoading } = useRatingContext();
  const [showChem, setShowChem] = useState(true);
  const playerMap = useMemo(() => new Map((players.data ?? []).map((p) => [p.id, p])), [players.data]);
  const result = useMemo(() => dreamTeam(ctx, settings.positionTemplate), [ctx, settings.positionTemplate]);
  const slots = Object.fromEntries(result.slots.map((s) => [s.position, s.playerId]));
  const chem = chemistryBonus(ctx, result.slots.map((s) => s.playerId));

  return (
    <>
      <TopBar title={t('dream.title')} subtitle={t('dream.subtitle')} />
      <div className="page">
        {isLoading || players.isLoading ? (
          <LoadingList rows={2} height="h-64" />
        ) : result.slots.length === 0 ? (
          <EmptyState icon={<IconStar size={40} />} title={t('dream.notEnough')} hint={t('dream.notEnoughHint', { n: settings.minPositionGames })} />
        ) : (
          <div className="lg:grid lg:grid-cols-[420px_1fr] lg:gap-6">
            <div>
              <div className="panel panel-pink tx-halftone mb-3 flex items-center gap-4 px-4 py-3">
                <span className="num text-hero font-extrabold">{fmtNum(Math.round(result.rating))}</span>
                <div className="flex flex-col">
                  <span className="font-display text-h2 font-extrabold uppercase">{t('dream.rating')}</span>
                  <span className="text-small font-semibold">{t('boards.chemistry')} {fmtSigned(chem, 1)}</span>
                </div>
              </div>
              <Court
                top={{ color: 'a', slots: {} }}
                bottom={{ color: 'a', slots }}
                players={playerMap}
                stats={ctx.stats}
                ctx={ctx}
                settings={settings}
                template={settings.positionTemplate}
                showChemistry={showChem}
                single
              />
            </div>
            <div className="mt-4 lg:mt-0">
              <button type="button" className="chip mb-3" aria-pressed={showChem} onClick={() => setShowChem((v) => !v)}>
                {t('game.chemistryLines')}
              </button>
              <p className="mb-3 text-small text-fg-2">{t('dream.legend')}</p>
              {result.missing.length > 0 && (
                <p className="bg-warn-bg p-3 text-small font-semibold text-warn">{t('dream.missing', { pos: result.missing.map((p) => t(`pos.${p}`)).join('، ') })}</p>
              )}
              <ul className="card-panel divide-y divide-[var(--border)]">
                {result.slots.map((s) => (
                  <li key={s.position} className="flex min-h-[48px] items-center gap-3 px-3">
                    <span className="num w-7 bg-ink text-center font-extrabold text-on-ink">{fmtNum(s.position)}</span>
                    <span className="w-28 text-small text-fg-2">{t(`pos.${s.position}`)}</span>
                    <span className="flex-1 truncate font-bold">{displayName(playerMap.get(s.playerId)?.name ?? '')}</span>
                    <span className="num font-extrabold">{fmtNum(ctx.stats.get(s.playerId)?.positions.find((p) => p.position === s.position)?.rating ?? 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
