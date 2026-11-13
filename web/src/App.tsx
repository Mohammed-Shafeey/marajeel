import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { invalidateDerived, useQueue } from './api/hooks';
import { IconCalendar, IconSliders, IconStar, IconSync, IconTrophy, IconUsers } from './components/icons';
import { translateCode, useToast } from './components/ui';
import { sync } from './offline/queue';
import { usePrefs } from './Prefs';
import SessionsPage from './pages/SessionsPage';
import SessionPage from './pages/SessionPage';
import RecordGamePage from './pages/RecordGamePage';
import PlayersPage from './pages/PlayersPage';
import PlayerDetailPage from './pages/PlayerDetailPage';
import LeaderboardsPage from './pages/LeaderboardsPage';
import DreamTeamPage from './pages/DreamTeamPage';
import SettingsPage from './pages/SettingsPage';
import SignInPage from './pages/SignInPage';

const NAV = [
  { to: '/', key: 'sessions', icon: IconCalendar },
  { to: '/players', key: 'players', icon: IconUsers },
  { to: '/leaderboards', key: 'leaderboards', icon: IconTrophy },
  { to: '/dream', key: 'dream', icon: IconStar },
  { to: '/settings', key: 'settings', icon: IconSliders },
] as const;

export default function App() {
  const { t } = useTranslation();
  const { prefs } = usePrefs();
  const loc = useLocation();
  useOfflineSync();
  useScrollToTop();

  return (
    <div className="tx-concrete min-h-dvh lg:ps-[240px]">
      <SideNav />
      <OfflineBanner />
      {/* Re-mount on language/digit change so every formatted number re-renders. */}
      <main key={`${prefs.lang}-${prefs.digits}`}>
        <Routes>
          <Route path="/" element={<SessionsPage />} />
          <Route path="/sessions/:id" element={<SessionPage />} />
          <Route path="/sessions/:id/:tab" element={<SessionPage />} />
          <Route path="/sessions/:id/games/new" element={<RecordGamePage />} />
          <Route path="/sessions/:id/games/:gameId" element={<RecordGamePage />} />
          <Route path="/players" element={<PlayersPage />} />
          <Route path="/players/:id" element={<PlayerDetailPage />} />
          <Route path="/leaderboards" element={<LeaderboardsPage />} />
          <Route path="/dream" element={<DreamTeamPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/signin" element={<SignInPage />} />
          <Route path="*" element={<SessionsPage />} />
        </Routes>
      </main>
      <nav aria-label={t('app.name')} className="bnav fixed inset-x-0 bottom-0 z-40 lg:hidden">
        {NAV.map(({ to, key, icon: Icon }) => (
          <Link key={to} to={to} aria-current={isActive(to, loc.pathname) ? 'page' : undefined}>
            <Icon size={22} />
            <span>{t(`nav.${key}`)}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** New pages open at the top (the browser would otherwise keep the previous page's scroll); Back/Forward keep theirs. */
function useScrollToTop() {
  const { pathname } = useLocation();
  const type = useNavigationType();
  useEffect(() => {
    if (type !== 'POP') window.scrollTo(0, 0);
  }, [pathname, type]);
}

const isActive = (to: string, path: string) => (to === '/' ? path === '/' || path.startsWith('/sessions') : path.startsWith(to));

function SideNav() {
  const { t } = useTranslation();
  const loc = useLocation();
  return (
    <aside className="fixed inset-y-0 start-0 z-40 hidden w-[240px] flex-col bg-[#121218] text-[#C3C2CB] lg:flex">
      <div className="px-5 py-6">
        <div className="font-display text-[28px] font-extrabold leading-none text-white">{t('app.name')}</div>
        <div className="swash mt-2 h-3 w-32" style={{ ['--swash' as string]: 'var(--brand)' }} />
      </div>
      <nav className="flex flex-col gap-1 px-3">
        {NAV.map(({ to, key, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            aria-current={isActive(to, loc.pathname) ? 'page' : undefined}
            className={`flex min-h-[48px] items-center gap-3 px-3 font-display text-[19px] font-bold ${isActive(to, loc.pathname) ? 'bg-brand text-white' : 'hover:text-white'}`}
          >
            <Icon />
            {t(key === 'dream' ? 'nav.dreamLong' : `nav.${key}`)}
          </Link>
        ))}
      </nav>
    </aside>
  );
}

function OfflineBanner() {
  const { t } = useTranslation();
  const ops = useQueue();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener('online', on);
    addEventListener('offline', off);
    return () => {
      removeEventListener('online', on);
      removeEventListener('offline', off);
    };
  }, []);
  if (online && ops.length === 0) return null;
  return (
    <div role="status" className="sticky top-0 z-[35] flex items-center justify-center gap-2 bg-volt px-4 py-2 text-center text-small font-bold text-on-volt">
      <IconSync size={16} />
      {!online ? t('sync.offline') : ''} {ops.length > 0 && t('sync.queued', { count: ops.length })}
      {online && ops.length > 0 && (
        <button type="button" className="underline" onClick={() => void sync()}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

/** Replays queued games when the connection returns, on start, and every 30 s. */
function useOfflineSync() {
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const r = await sync();
      if (!alive) return;
      if (r.sent > 0) {
        toast(t('sync.sent', { count: r.sent }));
        invalidateDerived(qc);
        void qc.invalidateQueries({ queryKey: ['session'] });
      }
      for (const f of r.failed) {
        const reason = f.error.errors.length ? translateCode(f.error.errors[0].code, f.error.errors[0].params, t) : translateCode(f.error.code, null, t);
        toast(t('sync.rejected', { reason }), 'error');
        void qc.invalidateQueries({ queryKey: ['session'] });
      }
    };
    void run();
    addEventListener('online', run);
    const timer = setInterval(run, 30_000);
    return () => {
      alive = false;
      removeEventListener('online', run);
      clearInterval(timer);
    };
  }, [qc, toast, t]);
}
