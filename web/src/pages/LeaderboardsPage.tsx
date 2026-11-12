import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAnalytics, usePlayers, useSettings, type AnalyticsWindow } from '../api/hooks';
import type { Player, PlayerStats } from '../api/types';
import { Avatar, RatingDelta } from '../components/cards';
import { IconTrophy } from '../components/icons';
import { EmptyState, ErrorState, LoadingList, Segmented, TopBar } from '../components/ui';
import { fmtNum, fmtPct, fmtSigned } from '../i18n';
import { POSITIONS } from '../lib/positions';

type TabKey = 'overall' | 'positions' | 'mvp' | 'streaks' | 'games' | 'pairs';
const TABS: TabKey[] = ['overall', 'positions', 'mvp', 'streaks', 'games', 'pairs'];

interface Col<R> {
  key: string;
  label: string;
  value: (r: R) => number | string;
  render?: (r: R) => ReactNode;
  numeric?: boolean;
}

export default function LeaderboardsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>('overall');
  const [window, setWindow] = useState<AnalyticsWindow>('all');
  const [pos, setPos] = useState(4);
  const players = usePlayers();
  const { settings } = useSettings();
  const all = useAnalytics('all');
  const win = useAnalytics(window);
  const pmap = useMemo(() => new Map((players.data ?? []).map((p) => [p.id, p])), [players.data]);
  const allStats = useMemo(() => new Map((all.data?.players ?? []).map((s) => [s.playerId, s])), [all.data]);

  type Row = PlayerStats & { player: Player; allTime: PlayerStats };
  const rows: Row[] = useMemo(
    () =>
      (win.data?.players ?? [])
        .map((s) => ({ ...s, player: pmap.get(s.playerId)!, allTime: allStats.get(s.playerId)! }))
        .filter((r) => r.player && r.allTime && r.player.isActive && r.allTime.positions.length > 0),
    [win.data, pmap, allStats],
  );

  const name = (r: { player: Player }) => (
    <Link to={`/players/${r.player.id}`} className="flex min-w-0 items-center gap-2 py-1">
      <Avatar player={r.player} size={32} />
      <span className="truncate font-bold">{r.player.name}</span>
    </Link>
  );
  const nameCol: Col<Row> = { key: 'name', label: t('boards.player'), value: (r) => r.player.name, render: name };

  let content: ReactNode;
  if (tab === 'pairs') {
    type PairRow = { a: Player; b: Player; games: number; winPct: number; chem: number };
    const pairRows: PairRow[] = (win.data?.pairs ?? [])
      .filter((p) => p.together.games >= settings.minChemistryGames && pmap.get(p.a) && pmap.get(p.b))
      .map((p) => ({ a: pmap.get(p.a)!, b: pmap.get(p.b)!, games: p.together.games, winPct: p.together.wins / p.together.games, chem: p.together.chemistry * 20 }));
    content = (
      <SortTable
        rows={pairRows}
        rowKey={(r) => r.a.id + r.b.id}
        initial="chem"
        cols={[
          { key: 'pair', label: t('boards.player'), value: (r) => r.a.name, render: (r) => <span className="font-bold">{r.a.name.split(' ')[0]} + {r.b.name.split(' ')[0]}</span> },
          { key: 'games', label: t('boards.together'), value: (r) => r.games, numeric: true, render: (r) => fmtNum(r.games) },
          { key: 'win', label: t('boards.winPct'), value: (r) => r.winPct, numeric: true, render: (r) => fmtPct(r.winPct) },
          { key: 'chem', label: t('boards.chemistry'), value: (r) => r.chem, numeric: true, render: (r) => <span className={r.chem > 0.5 ? 'text-win' : r.chem < -0.5 ? 'text-loss' : ''}>{fmtSigned(r.chem, 1)}</span> },
        ]}
      />
    );
  } else if (tab === 'positions') {
    type PosRow = Row & { posRating: number; posGames: number; established: boolean };
    const posRows: PosRow[] = rows
      .map((r) => {
        const ps = r.allTime.positions.find((p) => p.position === pos);
        return ps ? { ...r, posRating: ps.rating, posGames: ps.games, established: ps.games >= settings.minPositionGames } : null;
      })
      .filter((x): x is PosRow => !!x);
    content = (
      <>
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={t('boards.positions')}>
          {POSITIONS.filter((p) => settings.positionTemplate.includes(p)).map((p) => (
            <button key={p} type="button" className="chip" aria-pressed={pos === p} onClick={() => setPos(p)}>
              <span className="num">{fmtNum(p)}</span> {t(`pos.${p}`)}
            </button>
          ))}
        </div>
        <SortTable
          rows={posRows}
          rowKey={(r) => r.playerId}
          initial="rating"
          cols={[
            nameCol as unknown as Col<PosRow>,
            { key: 'rating', label: t('boards.rating'), value: (r) => (r.established ? r.posRating : r.posRating - 1000), numeric: true, render: (r) => <span className={r.established ? '' : 'text-fg-3'}>{fmtNum(r.posRating)}</span> },
            { key: 'games', label: t('boards.games'), value: (r) => r.posGames, numeric: true, render: (r) => fmtNum(r.posGames) },
          ]}
        />
      </>
    );
  } else {
    const colsByTab: Record<Exclude<TabKey, 'pairs' | 'positions'>, Col<Row>[]> = {
      overall: [
        nameCol,
        { key: 'rating', label: t('boards.rating'), value: (r) => (r.allTime.provisional ? r.allTime.rating - 1000 : r.allTime.rating), numeric: true, render: (r) => (
          <span className="inline-flex items-center gap-1">{window === 'month' && <RatingDelta delta={r.ratingDelta} />}<span className={r.allTime.provisional ? 'text-fg-3' : ''}>{fmtNum(r.allTime.rating)}</span></span>
        ) },
        { key: 'games', label: t('boards.games'), value: (r) => r.games, numeric: true, render: (r) => fmtNum(r.games) },
        { key: 'win', label: t('boards.winPct'), value: (r) => r.winPct, numeric: true, render: (r) => (r.games ? fmtPct(r.winPct) : '—') },
      ],
      mvp: [
        nameCol,
        { key: 'mvps', label: t('boards.mvp'), value: (r) => r.mvps, numeric: true, render: (r) => fmtNum(r.mvps) },
        { key: 'games', label: t('boards.games'), value: (r) => r.games, numeric: true, render: (r) => fmtNum(r.games) },
      ],
      streaks: [
        nameCol,
        { key: 'longest', label: t('boards.longest'), value: (r) => r.longestStreak, numeric: true, render: (r) => fmtNum(r.longestStreak) },
        { key: 'current', label: t('boards.current'), value: (r) => r.currentStreak, numeric: true, render: (r) => fmtNum(r.currentStreak) },
      ],
      games: [
        nameCol,
        { key: 'games', label: t('boards.games'), value: (r) => r.games, numeric: true, render: (r) => fmtNum(r.games) },
        { key: 'sessions', label: t('nav.sessions'), value: (r) => Object.keys(r.gamesBySession).length, numeric: true, render: (r) => fmtNum(Object.keys(r.gamesBySession).length) },
        { key: 'per', label: t('boards.perSession'), value: (r) => (Object.keys(r.gamesBySession).length ? r.games / Object.keys(r.gamesBySession).length : 0), numeric: true, render: (r) => (Object.keys(r.gamesBySession).length ? fmtNum(r.games / Object.keys(r.gamesBySession).length, { maximumFractionDigits: 1 }) : '—') },
      ],
    };
    const initial = { overall: 'rating', mvp: 'mvps', streaks: 'longest', games: 'games' }[tab];
    content = <SortTable key={tab} rows={tab === 'overall' ? rows : rows.filter((r) => r.games > 0)} rowKey={(r) => r.playerId} initial={initial} cols={colsByTab[tab]} />;
  }

  const loading = players.isLoading || all.isLoading || win.isLoading;
  const error = players.error || all.error || win.error;
  return (
    <>
      <TopBar title={t('boards.title')} subtitle={players.data && t('count.players', { count: rows.length })} />
      <div className="tabs sticky top-[60px] z-20 overflow-x-auto lg:top-0" role="tablist">
        {TABS.map((k) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} className="tab min-w-[84px] px-2" onClick={() => setTab(k)}>
            {t(`boards.${k}`)}
          </button>
        ))}
      </div>
      <div className="page">
        <div className="mb-3">
          <Segmented label={t('common.allTime')} value={window} onChange={setWindow} options={[{ value: 'month', label: t('common.thisMonth') }, { value: 'all', label: t('common.allTime') }]} />
        </div>
        {loading ? <LoadingList rows={8} height="h-11" /> : error ? <ErrorState error={error} onRetry={() => { void all.refetch(); void win.refetch(); }} /> : rows.length === 0 ? (
          <EmptyState icon={<IconTrophy size={40} />} title={t('boards.empty')} hint={t('boards.emptyHint')} />
        ) : (
          content
        )}
      </div>
    </>
  );
}

function SortTable<R>({ rows, cols, rowKey, initial }: { rows: R[]; cols: Col<R>[]; rowKey: (r: R) => string; initial: string }) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: initial, desc: true });
  const col = cols.find((c) => c.key === sort.key) ?? cols[0];
  const sorted = rows.slice().sort((a, b) => {
    const x = col.value(a);
    const y = col.value(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ar');
    return sort.desc ? -c : c;
  });
  if (rows.length === 0) return <EmptyState title={t('boards.empty')} hint={t('boards.emptyHint')} />;
  return (
    <div className="card-panel overflow-x-auto">
      <table className="w-full border-collapse text-small">
        <thead className="bg-surface-2">
          <tr>
            <th className="w-10 px-2 py-2 text-center font-display text-[15px]">{t('boards.rank')}</th>
            {cols.map((c) => (
              <th key={c.key} aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'} className={`px-2 py-0 ${c.numeric ? 'text-end' : 'text-start'}`}>
                <button
                  type="button"
                  className="min-h-tap font-display text-[15px] font-bold"
                  aria-label={t('boards.sortBy', { col: c.label })}
                  onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}
                >
                  {c.label} {sort.key === c.key ? (sort.desc ? '▼' : '▲') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={rowKey(r)} className="border-t border-line">
              <td className={`num px-2 text-center font-extrabold ${i < 3 && sort.desc ? 'text-brand-text' : 'text-fg-3'}`}>{fmtNum(i + 1)}</td>
              {cols.map((c) => (
                <td key={c.key} className={`px-2 ${c.numeric ? 'text-end font-num text-[17px] font-extrabold tabular-nums' : 'max-w-[180px]'}`}>
                  {c.render ? c.render(r) : String(c.value(r))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
