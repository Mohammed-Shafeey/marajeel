// Usage: node scripts/seed.ts [--local|--remote] [--seed 42] [--players 30] [--sessions 15]
// Wipes players/sessions/games, then writes 30 fake players with hidden "true" skills and ~15
// simulated weekly sessions, and prints how well the rating replay recovers those true skills.
// Admins and settings are left alone.
import { compute } from '../worker/src/core/analytics.ts';
import { generateDemo } from '../worker/src/core/demo.ts';
import { DEFAULT_SETTINGS } from '../worker/src/core/settings.ts';
import { execSql, lit, targetFromArgs } from './d1.ts';

const args = process.argv.slice(2);
const arg = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  const v = i >= 0 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
};
const target = targetFromArgs(args);

const world = generateDemo(arg('--seed', 42), arg('--players', 30), arg('--sessions', 15));
const sql: string[] = [
  'DELETE FROM game_participants;',
  'DELETE FROM games;',
  'DELETE FROM session_players;',
  'DELETE FROM session_teams;',
  'DELETE FROM sessions;',
  'DELETE FROM photos;',
  'DELETE FROM players;',
  'DELETE FROM analytics_cache;',
  'UPDATE meta SET data_version = data_version + 1;',
];
for (const p of world.players)
  sql.push(
    `INSERT INTO players (id, name, preferred_position, is_active, created_at) VALUES (${lit(p.id)}, ${lit(p.name)}, ${p.preferredPosition}, 1, ${lit(p.createdAt)});`,
  );
for (const s of world.sessions) {
  sql.push(`INSERT INTO sessions (id, date, status, created_at) VALUES (${lit(s.id)}, ${lit(s.date)}, ${lit(s.status)}, ${lit(s.createdAt)});`);
  for (const t of s.teams)
    sql.push(`INSERT INTO session_teams (id, session_id, label, color, sort_order) VALUES (${lit(t.id)}, ${lit(s.id)}, ${lit(t.label)}, ${lit(t.color)}, ${t.sortOrder});`);
  for (const r of s.roster)
    sql.push(
      `INSERT INTO session_players (session_id, player_id, team_id, position, is_bench, checked_in_at) VALUES (${lit(s.id)}, ${lit(r.playerId)}, ${lit(r.teamId)}, ${lit(r.position)}, ${lit(r.isBench)}, ${lit(s.createdAt)});`,
    );
  for (const g of s.games) {
    sql.push(
      `INSERT INTO games (id, session_id, team_a_id, team_b_id, score_a, score_b, mvp_player_id, played_at, created_at) VALUES (${lit(g.id)}, ${lit(s.id)}, ${lit(g.teamAId)}, ${lit(g.teamBId)}, ${g.scoreA}, ${g.scoreB}, ${lit(g.mvpPlayerId)}, ${lit(g.playedAt)}, ${lit(g.createdAt)});`,
    );
    for (const p of g.participants)
      sql.push(`INSERT INTO game_participants (game_id, player_id, side, position) VALUES (${lit(g.id)}, ${lit(p.playerId)}, ${lit(p.side)}, ${p.position});`);
  }
}

console.log(`Writing ${world.players.length} players, ${world.sessions.length} sessions, ${world.sessions.reduce((n, s) => n + s.games.length, 0)} games (${target})…`);
execSql(sql.join('\n'), target);

const result = compute(world.players.map((p) => p.id), world.sessions.flatMap((s) => s.games), DEFAULT_SETTINGS);
console.log('\nTrue skill vs recovered rating (sorted by true skill):');
console.log(`${'Player'.padEnd(24)} ${'true'.padStart(6)} ${'μ'.padStart(7)} ${'σ'.padStart(6)} ${'shown'.padStart(6)} ${'games'.padStart(6)}`);
for (const p of world.players.slice().sort((a, b) => b.trueSkill - a.trueSkill)) {
  const r = result.players.find((x) => x.playerId === p.id)!;
  console.log(`${p.name.padEnd(24)} ${p.trueSkill.toFixed(1).padStart(6)} ${r.mu.toFixed(1).padStart(7)} ${r.sigma.toFixed(2).padStart(6)} ${String(r.rating).padStart(6)} ${String(r.games).padStart(6)}`);
}
const xs = world.players.map((p) => p.trueSkill);
const ys = world.players.map((p) => result.players.find((x) => x.playerId === p.id)!.mu);
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const mx = mean(xs);
const my = mean(ys);
const corr = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0));
console.log(`\nPearson correlation(true skill, μ) = ${corr.toFixed(2)}`);
