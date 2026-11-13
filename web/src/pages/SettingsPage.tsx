import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { usePlayers, useQueue, useSaveSettings, useSessions, useSettings } from '../api/hooks';
import type { Game, GroupSettings } from '../api/types';
import { Link } from 'react-router-dom';
import { signInLink, type Role, useAddAdmin, useAdmins, useAuth, useRemoveAdmin, useResetAdminLink, useSignOut } from '../auth/useAuth';
import { IconDownload } from '../components/icons';
import { Button, SectionTitle, Segmented, Sheet, Stepper, TopBar, errorMessage, useConfirm, useToast } from '../components/ui';
import { fmtNum } from '../i18n';
import { POSITIONS } from '../lib/positions';
import { usePrefs } from '../Prefs';

export default function SettingsPage() {
  const { t } = useTranslation();
  const { prefs, setPrefs } = usePrefs();
  const auth = useAuth();
  const signOut = useSignOut();
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
                {t('settings.signedInAs', { name: auth.name })} · <b>{auth.isAdmin ? t('settings.admin') : auth.isJudge ? t('settings.judge') : t('settings.viewer')}</b>
              </span>
              <Button disabled={signOut.isPending} onClick={() => signOut.mutate()}>{t('common.signOut')}</Button>
            </>
          ) : (
            <>
              <span className="flex-1 text-small text-fg-2">{t('settings.viewerHint')}</span>
              <Link className="btn btn-ink" to="/signin">{t('common.signIn')}</Link>
            </>
          )}
        </div>

        {admin && <AdminsSection />}

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

/** Admins list: add someone (shows their personal link once), make a new link, remove. */
function AdminsSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const admins = useAdmins(true);
  const add = useAddAdmin();
  const reset = useResetAdminLink();
  const remove = useRemoveAdmin();
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('judge');
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const fail = (e: unknown) => toast(errorMessage(e, t), 'error');

  return (
    <>
      <SectionTitle>{t('auth.admins')}</SectionTitle>
      <div className="card-panel flex flex-col divide-y divide-line">
        {(admins.data ?? []).map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
            <span className="min-w-0 flex-1 truncate font-semibold">
              {a.name}
              {a.isYou && <span className="ms-2 text-caption text-fg-3">({t('common.you')})</span>}
            </span>
            <span className={`px-2 py-0.5 font-display text-caption font-extrabold ${a.role === 'admin' ? 'bg-brand text-on-brand' : 'bg-cyan text-on-cyan'}`}>
              {a.role === 'admin' ? t('settings.admin') : t('settings.judge')}
            </span>
            <Button
              variant="ghost"
              disabled={reset.isPending}
              onClick={async () => {
                if (!(await confirm(t('auth.resetConfirm', { name: a.name })))) return;
                reset.mutate(a.id, { onSuccess: (r) => setLink({ name: a.name, url: signInLink(r.code) }), onError: fail });
              }}
            >
              {t('auth.newLink')}
            </Button>
            {!a.isYou && (
              <Button
                variant="ghost"
                className="!text-loss"
                disabled={remove.isPending}
                onClick={async () => {
                  if (await confirm(t('auth.removeConfirm', { name: a.name }), { danger: true, confirmLabel: t('auth.remove') })) remove.mutate(a.id, { onError: fail });
                }}
              >
                {t('auth.remove')}
              </Button>
            )}
          </div>
        ))}
        <form
          className="flex flex-wrap gap-2 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return;
            add.mutate({ name: n, role }, {
              onSuccess: (r) => {
                setLink({ name: n, url: signInLink(r.code) });
                setName('');
              },
              onError: fail,
            });
          }}
        >
          <div className="flex w-full gap-2" role="group" aria-label={t('auth.role')}>
            {(['judge', 'admin'] as const).map((r) => (
              <button key={r} type="button" className="chip" aria-pressed={role === r} onClick={() => setRole(r)}>
                {r === 'admin' ? t('settings.admin') : t('settings.judge')}
              </button>
            ))}
            <span className="self-center text-caption text-fg-3">{role === 'admin' ? t('auth.adminHint') : t('auth.judgeHint')}</span>
          </div>
          <input className="min-w-0 flex-1" placeholder={t('auth.adminName')} aria-label={t('auth.adminName')} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="ink" disabled={add.isPending || !name.trim()}>
            {role === 'admin' ? t('auth.addAdmin') : t('auth.addJudge')}
          </Button>
        </form>
      </div>

      <Sheet
        open={!!link}
        onClose={() => setLink(null)}
        title={link ? t('auth.linkFor', { name: link.name }) : ''}
        footer={
          link && (
            <>
              {'share' in navigator && (
                <Button onClick={() => void navigator.share({ url: link.url }).catch(() => {})}>{t('auth.share')}</Button>
              )}
              <Button
                variant="primary"
                onClick={() =>
                  void navigator.clipboard.writeText(link.url).then(
                    () => toast(t('auth.copied')),
                    () => toast(t('common.error'), 'error'),
                  )
                }
              >
                {t('auth.copy')}
              </Button>
            </>
          )
        }
      >
        <p className="mb-3 text-small text-fg-2">{t('auth.linkHint')}</p>
        <p dir="ltr" className="select-all break-all bg-surface-2 p-3 font-mono text-small">{link?.url}</p>
      </Sheet>
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
