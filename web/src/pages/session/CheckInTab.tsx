import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAnalytics, usePlayers, useSaveRoster, useSettings } from '../../api/hooks';
import type { RosterPlayer, SessionDetail } from '../../api/types';
import { useAuth } from '../../auth/useAuth';
import { MiniCard, Num } from '../../components/cards';
import { IconCheck } from '../../components/icons';
import { Button, EmptyState, LoadingList, Segmented, errorMessage, useToast } from '../../components/ui';
import { compareNames, matchesSearch } from '../../lib/arabic';

/**
 * Check-in: tap to mark present. Exactly teams × template players can play (12 or 18 by default);
 * the latest arrivals go to the bench automatically, and a long-press benches/un-benches anyone.
 */
export default function CheckInTab({ session }: { session: SessionDetail }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const toast = useToast();
  const auth = useAuth();
  const players = usePlayers();
  const analytics = useAnalytics('all');
  const { settings } = useSettings();
  const save = useSaveRoster(session.id);
  const size = settings.positionTemplate.length;

  const lockedIds = useMemo(() => new Set(session.games.flatMap((g) => g.participants.map((p) => p.playerId))), [session.games]);
  // Arrival order: the server roster order is preserved; newly tapped players are appended.
  const [present, setPresent] = useState<string[]>(() => session.players.map((p) => p.playerId));
  const [manualBench, setManualBench] = useState<Set<string>>(() => new Set(session.teams.length ? [] : session.players.filter((p) => p.isBench).map((p) => p.playerId)));
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'present' | 'absent'>('all');
  const dirty = useRef(false);

  const targets = settings.allowedTeamCounts.map((c) => c * size).sort((a, b) => a - b);
  const candidates = present.filter((id) => !manualBench.has(id));
  const target = [...targets].reverse().find((n) => n <= candidates.length) ?? null;
  const active = target ? candidates.slice(0, target) : [];
  const bench = new Set(present.filter((id) => !active.includes(id)));
  const statsById = new Map((analytics.data?.players ?? []).map((s) => [s.playerId, s]));

  const toggle = (id: string) => {
    if (!auth.isAdmin) return;
    if (lockedIds.has(id)) return toast(t('checkin.lockedHasGames'), 'info');
    dirty.current = true;
    setPresent((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  const toggleBench = (id: string) => {
    if (!auth.isAdmin || !present.includes(id)) return;
    dirty.current = true;
    setManualBench((b) => {
      const n = new Set(b);
      if (bench.has(id)) {
        n.delete(id);
        // Un-benching someone auto-benched: move them ahead of the latest arrival.
        setPresent((p) => [id, ...p.filter((x) => x !== id)]);
      } else n.add(id);
      return n;
    });
  };

  const list = useMemo(() => {
    const all = (players.data ?? []).filter((p) => p.isActive || present.includes(p.id));
    return all
      .filter((p) => matchesSearch(p.name, query))
      .filter((p) => (filter === 'present' ? present.includes(p.id) : filter === 'absent' ? !present.includes(p.id) : true))
      .sort((a, b) => (statsById.get(b.id)?.rating ?? 0) - (statsById.get(a.id)?.rating ?? 0) || compareNames(a.name, b.name));
  }, [players.data, present, query, filter, statsById]);

  /** Build the roster payload, keeping an existing base lineup valid where possible. */
  const buildRoster = (): RosterPlayer[] => {
    if (!session.teams.length) return present.map((id) => ({ playerId: id, teamId: null, position: null, isBench: bench.has(id) }));
    const existing = new Map(session.players.map((p) => [p.playerId, p]));
    const result: RosterPlayer[] = [];
    const newcomers = present.filter((id) => !existing.has(id));
    const holes: { teamId: string; position: number }[] = [];
    for (const p of session.players) {
      if (present.includes(p.playerId)) result.push(p);
      else if (!p.isBench && p.teamId && p.position) holes.push({ teamId: p.teamId, position: p.position });
    }
    for (const id of newcomers) result.push({ playerId: id, teamId: null, position: null, isBench: true });
    // Fill holes left by players who went home with bench players.
    for (const h of holes) {
      const sub = result.find((r) => r.isBench);
      if (!sub) break;
      Object.assign(sub, { teamId: h.teamId, position: h.position, isBench: false });
    }
    return result;
  };

  const submit = (goNext: boolean) =>
    save.mutate(
      { teams: session.teams, players: buildRoster() },
      {
        onSuccess: () => {
          dirty.current = false;
          toast(t('common.saved'));
          if (goNext) nav(`/sessions/${session.id}/teams`);
        },
        onError: (e) => toast(errorMessage(e, t), 'error'),
      },
    );

  if (players.isLoading) return <div className="page"><LoadingList rows={4} height="h-24" /></div>;
  if (!players.data?.length) return <div className="page"><EmptyState title={t('players.empty')} hint={t('checkin.noPlayers')} /></div>;

  const minTarget = targets[0];
  return (
    <>
      <div className="page">
        <input
          type="search"
          className="mb-3 w-full"
          placeholder={t('common.search')}
          aria-label={t('common.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <section className="card-panel mb-3 p-3" aria-live="polite">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-baseline gap-1">
              <Num n={present.length} className="text-[40px] font-extrabold leading-none" />
              <span className="font-semibold text-fg-2">{t('checkin.present')}</span>
            </span>
            {target ? (
              <span className="flex items-center gap-1 bg-win-bg px-2 py-1 font-display text-[15px] font-bold text-win">
                <IconCheck size={16} /> {t('checkin.playing', { n: target, teams: t('count.teams', { count: target / size }) })}
              </span>
            ) : (
              <span className="bg-warn-bg px-2 py-1 font-display text-[15px] font-bold text-warn">
                {t('checkin.tooFew', { n: minTarget - candidates.length, target: minTarget })}
              </span>
            )}
            {bench.size > 0 && <span className="bg-ink px-2 py-1 font-display text-[15px] font-bold text-on-ink">{t('count.bench', { count: bench.size })}</span>}
          </div>
          <Progress value={present.length} marks={targets} />
          <p className="mt-2 text-small text-fg-2">{t('checkin.hint')}</p>
        </section>

        <div className="mb-3">
          <Segmented
            label={t('checkin.title')}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `${t('checkin.filterAll')} ${list.length && filter === 'all' ? '' : ''}` },
              { value: 'present', label: t('checkin.filterPresent') },
              { value: 'absent', label: t('checkin.filterAbsent') },
            ]}
          />
        </div>

        {list.length === 0 ? (
          <EmptyState title={t('players.noMatch')} />
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] justify-items-center gap-x-2 gap-y-4">
            {list.map((p) => {
              const isPresent = present.includes(p.id);
              const isBench = bench.has(p.id);
              return (
                <li key={p.id}>
                  <LongPressButton
                    onTap={() => toggle(p.id)}
                    onLongPress={() => toggleBench(p.id)}
                    pressed={isPresent}
                    label={`${p.name}${isBench ? ` · ${t('card.benched')}` : ''}`}
                    disabled={!auth.isAdmin}
                  >
                    <MiniCard
                      player={p}
                      stats={statsById.get(p.id)}
                      settings={settings}
                      team={isPresent ? 'a' : null}
                      selected={isPresent && !isBench}
                      benched={isBench}
                      className={isPresent ? '' : 'opacity-60'}
                      badge={isBench ? <span className="absolute inset-x-0 -bottom-2 mx-auto w-fit bg-ink px-1 font-display text-[11px] font-bold text-on-ink">{t('card.benched')}</span> : null}
                    />
                  </LongPressButton>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {auth.isAdmin && (
        <div className="action-bar">
          <Button onClick={() => submit(false)} disabled={save.isPending}>{t('common.save')}</Button>
          <Button variant="primary" disabled={!target || save.isPending} onClick={() => submit(true)}>
            {t('checkin.toTeams')}
          </Button>
        </div>
      )}
    </>
  );
}

function Progress({ value, marks }: { value: number; marks: number[] }) {
  const max = Math.max(...marks) + 4;
  return (
    <div className="relative mt-3 h-6" aria-hidden="true">
      <div className="absolute inset-x-0 top-2 h-2 bg-surface-3" />
      <div className="absolute start-0 top-2 h-2 bg-win transition-[width] duration-300" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      {marks.map((m) => (
        <div key={m} className="absolute top-0 flex flex-col items-center" style={{ insetInlineStart: `${(m / max) * 100}%`, transform: 'translateX(-50%)' }}>
          <div className="h-6 w-0.5 bg-ink" />
          <span className="num text-caption font-bold">{m}</span>
        </div>
      ))}
    </div>
  );
}

/** Tap = toggle, long-press (500 ms) = secondary action. Keyboard: Enter = tap, Shift+Enter = long-press. */
function LongPressButton({ onTap, onLongPress, pressed, label, disabled, children }: { onTap: () => void; onLongPress: () => void; pressed: boolean; label: string; disabled?: boolean; children: React.ReactNode }) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const start = () => {
    fired.current = false;
    timer.current = window.setTimeout(() => {
      fired.current = true;
      navigator.vibrate?.(20);
      onLongPress();
    }, 500);
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      disabled={disabled}
      className="relative block disabled:cursor-default"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.shiftKey) {
          e.preventDefault();
          onLongPress();
        }
      }}
      onClick={() => {
        if (!fired.current) onTap();
      }}
    >
      {children}
    </button>
  );
}
