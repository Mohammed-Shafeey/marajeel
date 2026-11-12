import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAnalytics, usePlayers, useSettings } from '../api/hooks';
import type { Player } from '../api/types';
import { useAuth } from '../auth/useAuth';
import { PlayerCard } from '../components/cards';
import { IconPlus, IconUsers } from '../components/icons';
import { Button, EmptyState, ErrorState, Skeleton, TopBar } from '../components/ui';
import { compareNames, matchesSearch } from '../lib/arabic';
import PlayerEditSheet from './PlayerEditSheet';

export default function PlayersPage() {
  const { t } = useTranslation();
  const auth = useAuth();
  const players = usePlayers();
  const analytics = useAnalytics('all');
  const { settings } = useSettings();
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Player | 'new' | null>(null);

  const stats = useMemo(() => new Map((analytics.data?.players ?? []).map((s) => [s.playerId, s])), [analytics.data]);
  const list = useMemo(
    () =>
      (players.data ?? [])
        .filter((p) => showInactive || p.isActive)
        .filter((p) => matchesSearch(p.name, query) || matchesSearch(p.shortName ?? '', query))
        .sort((a, b) => Number(b.isActive) - Number(a.isActive) || (stats.get(b.id)?.rating ?? 0) - (stats.get(a.id)?.rating ?? 0) || compareNames(a.name, b.name)),
    [players.data, query, showInactive, stats],
  );
  const inactiveCount = (players.data ?? []).filter((p) => !p.isActive).length;

  return (
    <>
      <TopBar title={t('players.title')} subtitle={players.data && t('count.players', { count: players.data.filter((p) => p.isActive).length })} />
      <div className="page">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input type="search" className="min-w-0 flex-1" placeholder={t('common.search')} aria-label={t('common.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          {inactiveCount > 0 && (
            <button type="button" className="chip" aria-pressed={showInactive} onClick={() => setShowInactive((v) => !v)}>
              {t('players.showInactive')}
            </button>
          )}
        </div>
        {players.isLoading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] justify-items-center gap-4">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[300px] w-[200px]" />)}
          </div>
        ) : players.error ? (
          <ErrorState error={players.error} onRetry={() => void players.refetch()} />
        ) : players.data!.length === 0 ? (
          <EmptyState
            icon={<IconUsers size={40} />}
            title={t('players.empty')}
            hint={t('players.emptyHint')}
            action={auth.isAdmin && <Button variant="primary" onClick={() => setEditing('new')}>{t('players.add')}</Button>}
          />
        ) : list.length === 0 ? (
          <EmptyState title={t('players.noMatch')} />
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] justify-items-center gap-x-2 gap-y-4 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
            {list.map((p) => (
              <li key={p.id} className="origin-top max-sm:scale-[.8] max-sm:-mb-[60px]">
                <Link to={`/players/${p.id}`} aria-label={p.name} className="block transition-transform hover:-translate-y-1">
                  <PlayerCard player={p} stats={stats.get(p.id)} settings={settings} team="a" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {auth.isAdmin && (players.data?.length ?? 0) > 0 && (
        <div className="action-bar">
          <Button variant="primary" onClick={() => setEditing('new')}>
            <IconPlus /> {t('players.add')}
          </Button>
        </div>
      )}
      <PlayerEditSheet player={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
    </>
  );
}
