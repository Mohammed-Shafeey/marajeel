import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { usePlayers, useQueue, useSaveSettings, useSessions, useSettings } from '../api/hooks';
import type { Game, GroupSettings } from '../api/types';
import { useAuth } from '../auth/useAuth';
import { IconDownload } from '../components/icons';
import { Button, SectionTitle, Segmented, Stepper, TopBar, errorMessage, useToast } from '../components/ui';
import { fmtNum } from '../i18n';
import { POSITIONS } from '../lib/positions';
import { usePrefs } from '../Prefs';

export default function SettingsPage() {
  const { t } = useTranslation();
  const { prefs, setPrefs } = usePrefs();
  const auth = useAuth();
  const toast = useToast();
  const queue = useQueue();
  const { settings, isLoading } = useSettings();
  const save = useSaveSettings();
  const [draft, setDraft] = useState<GroupSettings>(settings);
  useEffect(() => setDraft(settings), [settings]);
  const set = (p: Partial<GroupSettings>) => setDraft((d) => ({ ...d, ...p }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const admin = auth.isAdmin;

  const togglePos = (p: number) =>
    set({ positionTemplate: draft.positionTemplate.includes(p) ? draft.positionTemplate.filter((x) => x !== p) : [...draft.positionTemplate, p].sort((a, b) => [4, 3, 2, 5, 6, 1].indexOf(a) - [4, 3, 2, 5, 6, 1].indexOf(b)) });
  const toggleCount = (c: number) =>
    set({ allowedTeamCounts: draft.allowedTeamCounts.includes(c) ? draft.allowedTeamCounts.filter((x) => x !== c) : [...draft.allowedTeamCounts, c].sort() });

  return (
    <>
      <TopBar
        title={t('settings.title')}
        actions={<span className="px-2 text-small font-bold text-[#C3C2CB]">{queue.length ? t('sync.queued', { count: queue.length }) : t('sync.synced')}</span>}
      />
      <div className="page max-w-2xl">
        <SectionTitle>{t('settings.display')}</SectionTitle>
        <div className="card-panel flex flex-col gap-4 p-4">
          <Row label={t('settings.language')}>
            <Segmented label={t('settings.language')} value={prefs.lang} onChange={(lang) => setPrefs({ lang })} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />
          </Row>
          <Row label={t('settings.digits')}>
            <Segmented label={t('settings.digits')} value={prefs.digits} onChange={(digits) => setPrefs({ digits })} options={[{ value: 'arab', label: '١٢٣' }, { value: 'latn', label: '123' }]} />
          </Row>
          <Row label={t('settings.theme')}>
            <Segmented
              label={t('settings.theme')}
              value={prefs.theme}
              onChange={(theme) => setPrefs({ theme })}
              options={[{ value: 'light', label: t('settings.light') }, { value: 'dark', label: t('settings.dark') }, { value: 'auto', label: t('settings.auto') }]}
            />
          </Row>
        </div>

        <fieldset disabled={!admin || isLoading} className="contents">
          <SectionTitle aside={!admin ? t('common.adminOnly') : undefined}>{t('settings.game')}</SectionTitle>
          <div className="card-panel flex flex-col gap-4 p-4">
            <Row label={t('settings.target')}>
              <div className="flex items-center gap-2">
                <Segmented label={t('settings.target')} value={String(draft.targetScore)} onChange={(v) => set({ targetScore: Number(v) })} options={['15', '21', '25'].map((v) => ({ value: v, label: fmtNum(Number(v)) }))} />
              </div>
            </Row>
            <Row label={t('settings.winByTwo')}>
              <input type="checkbox" className="!min-h-0 h-6 w-6" checked={draft.winByTwo} onChange={(e) => set({ winByTwo: e.target.checked })} />
            </Row>
            <div>
              <span className="field-label">{t('settings.template')}</span>
              <p className="mb-2 text-caption text-fg-3">{t('settings.templateHint')}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {POSITIONS.map((p) => (
                  <button key={p} type="button" aria-pressed={draft.positionTemplate.includes(p)} onClick={() => togglePos(p)} className={`flex min-h-tap items-center gap-2 px-2 text-start text-small font-semibold ${draft.positionTemplate.includes(p) ? 'bg-ink text-on-ink' : 'bg-surface-2 text-fg-3'}`}>
                    <span className="num w-5 text-center font-extrabold">{fmtNum(p)}</span>
                    {t(`pos.${p}`)}
                  </button>
                ))}
              </div>
            </div>
            <Row label={t('settings.teamCounts')}>
              <div className="flex gap-2">
                {[2, 3, 4].map((c) => (
                  <button key={c} type="button" className="chip !min-h-[44px] !min-w-[44px] justify-center" aria-pressed={draft.allowedTeamCounts.includes(c)} onClick={() => toggleCount(c)}>
                    {fmtNum(c)} <span className="text-caption opacity-70">({fmtNum(c * draft.positionTemplate.length)})</span>
                  </button>
                ))}
              </div>
            </Row>
          </div>

          <SectionTitle>{t('settings.thresholds')}</SectionTitle>
          <div className="card-panel flex flex-col gap-4 p-4">
            <Row label={t('settings.provisional')} hint={t('settings.provisionalHint')}>
              <Stepper label={t('settings.provisional')} value={draft.provisionalGames} min={1} max={50} onChange={(v) => set({ provisionalGames: v })} />
            </Row>
            <Row label={t('settings.minPosition')}>
              <Stepper label={t('settings.minPosition')} value={draft.minPositionGames} min={1} max={50} onChange={(v) => set({ minPositionGames: v })} />
            </Row>
            <Row label={t('settings.minChem')} hint={t('settings.minChemHint')}>
              <Stepper label={t('settings.minChem')} value={draft.minChemistryGames} min={1} max={50} onChange={(v) => set({ minChemistryGames: v })} />
            </Row>
            <Row label={t('settings.gold')}>
              <Stepper label={t('settings.gold')} value={draft.goldThreshold} min={2} max={100} onChange={(v) => set({ goldThreshold: v })} />
            </Row>
            <Row label={t('settings.silver')} hint={t('settings.silverHint')}>
              <Stepper label={t('settings.silver')} value={draft.silverThreshold} min={1} max={draft.goldThreshold - 1} onChange={(v) => set({ silverThreshold: v })} />
            </Row>
          </div>
        </fieldset>

        <SectionTitle>{t('settings.account')}</SectionTitle>
        <div className="card-panel flex flex-wrap items-center gap-3 p-4">
          {auth.signedIn ? (
            <>
              <span className="flex-1">
                {t('settings.signedInAs', { name: auth.name })} · <b>{auth.isAdmin ? t('settings.admin') : t('settings.viewer')}</b>
              </span>
              <a className="btn btn-outline" href={auth.signOutUrl}>{t('common.signOut')}</a>
            </>
          ) : (
            <>
              <span className="flex-1 text-small text-fg-2">{t('settings.viewerHint')}</span>
              <a className="btn btn-ink" href={auth.signInUrl}>{t('common.signIn')}</a>
            </>
          )}
        </div>

        <SectionTitle>{t('settings.export')}</SectionTitle>
        <div className="card-panel flex items-center gap-3 p-4">
          <span className="flex-1 text-small text-fg-2">{t('settings.exportHint')}</span>
          <ExportButton />
        </div>

        <SectionTitle>{t('settings.about')}</SectionTitle>
        <p className="card-panel p-4 text-small text-fg-2">{t('settings.aboutText')}</p>
      </div>
      {admin && dirty && (
        <div className="action-bar">
          <Button onClick={() => setDraft(settings)}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={save.isPending}
            onClick={() => save.mutate(draft, { onSuccess: () => toast(t('common.saved')), onError: (e) => toast(errorMessage(e, t), 'error') })}
          >
            {t('settings.saveGroup')}
          </Button>
        </div>
      )}
    </>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <div className="font-semibold">{label}</div>
        {hint && <div className="text-caption text-fg-3">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function ExportButton() {
  const { t } = useTranslation();
  const toast = useToast();
  const players = usePlayers();
  const sessions = useSessions();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const games = await api<Game[]>('games');
      const name = new Map((players.data ?? []).map((p) => [p.id, p.name]));
      const date = new Map((sessions.data ?? []).map((s) => [s.id, s.date]));
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const lines = [['session_date', 'game_id', 'played_at', 'score_a', 'score_b', 'mvp', 'side', 'position', 'player'].join(',')];
      for (const g of games)
        for (const p of g.participants)
          lines.push([date.get(g.sessionId) ?? '', g.id, g.playedAt, g.scoreA, g.scoreB, esc(name.get(g.mvpPlayerId) ?? ''), p.side, p.position, esc(name.get(p.playerId) ?? '')].join(','));
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `marajeel-games-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast(errorMessage(e, t), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button onClick={() => void run()} disabled={busy}>
      <IconDownload size={18} /> CSV
    </Button>
  );
}
