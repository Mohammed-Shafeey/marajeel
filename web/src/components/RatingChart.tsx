import { useTranslation } from 'react-i18next';
import type { RatingPoint } from '../api/types';
import { fmtDate, fmtNum } from '../i18n';

/** Small dependency-free line chart of rating over time. Time runs left→right in both directions (dir=ltr). */
export function RatingChart({ points, height = 180 }: { points: RatingPoint[]; height?: number }) {
  const { t } = useTranslation();
  if (points.length < 2) return <p className="py-8 text-center text-small text-fg-3">{t('player.historyEmpty')}</p>;
  const W = 340;
  const H = height;
  const pad = { l: 30, r: 10, t: 12, b: 22 };
  const ys = points.map((p) => p.rating);
  const lo = Math.max(0, Math.floor((Math.min(...ys) - 3) / 5) * 5);
  const hi = Math.min(100, Math.ceil((Math.max(...ys) + 3) / 5) * 5);
  const x = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join('');
  const area = `${d}L${x(points.length - 1)},${H - pad.b}L${x(0)},${H - pad.b}Z`;
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  const labelIdx = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const last = points[points.length - 1];
  return (
    <svg style={{ direction: 'ltr' }} viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${t('player.history')}: ${fmtNum(points[0].rating)} → ${fmtNum(last.rating)}`}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeDasharray="3 4" />
          <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--text-3)" fontFamily="var(--font-num)">{fmtNum(v)}</text>
        </g>
      ))}
      <path d={area} fill="var(--brand)" opacity=".12" />
      <path d={d} fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(last.rating)} r="5" fill="var(--brand)" stroke="var(--surface)" strokeWidth="2" />
      {labelIdx.map((i) => (
        <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} fontSize="11" fill="var(--text-3)" fontFamily="var(--font-ui)">
          {fmtDate(points[i].playedAt, { month: 'short', day: 'numeric' })}
        </text>
      ))}
    </svg>
  );
}
