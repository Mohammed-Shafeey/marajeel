import { currentAdmin, randomToken, sameOrigin, sessionCookie, SESSION_DAYS, sha256, type Admin, type Role } from './auth.ts';
import { compute, type GameRecord, type Side } from './core/analytics.ts';
import { isValidPosition, normalizeSettings, type GroupSettings } from './core/settings.ts';
import { validateGame, validatePlayer, validateRoster, validateSettings, type GameParticipantInput, type RosterInput, type ValidationError } from './core/validators.ts';
import { ApiException, body, errorResponse, guid, isoDateTime, json, noContent, notFound, throwIfInvalid } from './http.ts';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

interface Ctx {
  req: Request;
  env: Env;
  db: D1Database;
  url: URL;
  params: string[];
  admin: Admin | null;
}

type Handler = (c: Ctx) => Promise<Response>;
/** Who may call a route: anyone, a judge or admin, or an admin only. */
type Access = 'public' | 'judge' | 'admin';
interface Route {
  method: string;
  pattern: RegExp;
  access: Access;
  handler: Handler;
}

const ID = '([0-9a-fA-F-]{36})';
const routes: Route[] = [];
const route = (method: string, path: string, access: Access, handler: Handler) =>
  routes.push({ method, pattern: new RegExp(`^/api/${path.replace(/:id/g, ID)}/?$`), access, handler });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);

    const match = routes.map((r) => ({ r, m: r.pattern.exec(url.pathname) })).filter((x) => x.m);
    if (match.length === 0) return errorResponse(404, 'notFound', 'No such API route.');
    const hit = match.find((x) => x.r.method === req.method || (req.method === 'HEAD' && x.r.method === 'GET'));
    if (!hit) return errorResponse(405, 'methodNotAllowed', 'Method not allowed.');

    try {
      const admin = await currentAdmin(req, env.DB);
      if (hit.r.access !== 'public') {
        if (!admin) return errorResponse(401, 'auth.required', 'Sign in as an admin to make changes.');
        if (!sameOrigin(req)) return errorResponse(403, 'auth.forbidden', 'Cross-site requests are not allowed.');
        if (hit.r.access === 'admin' && admin.role !== 'admin') return errorResponse(403, 'auth.adminOnly', 'Only admins can do this.');
      }
      return await hit.r.handler({ req, env, db: env.DB, url, params: hit.m!.slice(1), admin });
    } catch (e) {
      if (e instanceof ApiException) return errorResponse(e.status, e.code, e.message, e.errors);
      console.error(e);
      return errorResponse(500, 'server.error', 'Something went wrong on the server.');
    }
  },
} satisfies ExportedHandler<Env>;

// ---- shared ----------------------------------------------------------------------------------------

const now = () => new Date().toISOString();
/** Every write bumps the data version so cached analytics are ignored from then on. */
const bump = (db: D1Database) => db.prepare('UPDATE meta SET data_version = data_version + 1 WHERE id = 1');

async function getSettings(db: D1Database): Promise<GroupSettings> {
  const row = await db.prepare('SELECT json FROM app_settings WHERE id = 1').first<{ json: string }>();
  return parseSettings(row?.json);
}
function parseSettings(text: string | undefined | null): GroupSettings {
  if (!text) return normalizeSettings(null);
  try {
    return normalizeSettings(JSON.parse(text));
  } catch {
    return normalizeSettings(null);
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);

/** Judges may only change open sessions (admins can change any, and alone can close/reopen them). */
async function requireOpenForJudge(db: D1Database, admin: Admin | null, sessionId: string) {
  if (admin?.role !== 'judge') return;
  const row = await db.prepare('SELECT status FROM sessions WHERE id = ?').bind(sessionId).first<{ status: string }>();
  if (row && row.status !== 'open') throw new ApiException(403, 'session.closedForJudge', 'This session is closed. Only an admin can change it.');
}
const cleanShort = (s: unknown) => {
  const v = str(s)?.trim();
  return v ? v.slice(0, 20) : null;
};

// ---- players ---------------------------------------------------------------------------------------

interface PlayerRow {
  id: string;
  name: string;
  short_name: string | null;
  photo_version: number | null;
  preferred_position: number;
  is_active: number;
  created_at: string;
}
const playerDto = (p: PlayerRow) => ({
  id: p.id,
  name: p.name,
  shortName: p.short_name,
  photoUrl: p.photo_version != null ? `/api/photos/${p.id}-${p.photo_version}` : null,
  preferredPosition: p.preferred_position,
  isActive: !!p.is_active,
  createdAt: p.created_at,
});
const loadPlayer = async (db: D1Database, id: string) => {
  const p = await db.prepare('SELECT * FROM players WHERE id = ?').bind(id).first<PlayerRow>();
  if (!p) throw notFound('player');
  return p;
};

route('GET', 'players', 'public', async ({ db }) => {
  const { results } = await db.prepare('SELECT * FROM players ORDER BY name').all<PlayerRow>();
  return json(results.map(playerDto));
});

interface PlayerInput {
  name?: unknown;
  shortName?: unknown;
  preferredPosition?: unknown;
  isActive?: unknown;
}

route('POST', 'players', 'admin', async ({ db, req }) => {
  const input = await body<PlayerInput>(req);
  throwIfInvalid(validatePlayer(input.name, input.preferredPosition));
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare('INSERT INTO players (id, name, short_name, preferred_position, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, (input.name as string).trim(), cleanShort(input.shortName), input.preferredPosition as number, input.isActive === false ? 0 : 1, now()),
    bump(db),
  ]);
  return json(playerDto(await loadPlayer(db, id)), 201);
});

route('PUT', 'players/:id', 'admin', async ({ db, req, params }) => {
  const id = guid(params[0], 'id');
  const input = await body<PlayerInput>(req);
  throwIfInvalid(validatePlayer(input.name, input.preferredPosition));
  const p = await loadPlayer(db, id);
  const active = typeof input.isActive === 'boolean' ? (input.isActive ? 1 : 0) : p.is_active;
  await db.batch([
    db
      .prepare('UPDATE players SET name = ?, short_name = ?, preferred_position = ?, is_active = ? WHERE id = ?')
      .bind((input.name as string).trim(), cleanShort(input.shortName), input.preferredPosition as number, active, id),
    bump(db),
  ]);
  return json(playerDto(await loadPlayer(db, id)));
});

const MAX_PHOTO_BYTES = 1_000_000;
const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isWebP = (b: Uint8Array) =>
  b.length > 12 && String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' && String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP';

/**
 * The client crops to a square, resizes to 512px and encodes WebP (JPEG on browsers that can't encode
 * WebP, e.g. Safari), then PUTs the bytes here. Stored in D1 (photos are small); names are versioned.
 */
route('PUT', 'players/:id/photo', 'admin', async ({ db, req, params }) => {
  const id = guid(params[0], 'id');
  const p = await loadPlayer(db, id);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) throw new ApiException(400, 'photo.empty', 'The photo is empty.');
  if (bytes.length > MAX_PHOTO_BYTES) throw new ApiException(400, 'photo.tooLarge', 'The photo must be under 1 MB.');
  const contentType = isWebP(bytes) ? 'image/webp' : isJpeg(bytes) ? 'image/jpeg' : null;
  if (!contentType) throw new ApiException(400, 'photo.notWebp', 'The photo must be a WebP (or JPEG) image.');
  // A timestamp, not old+1: after a photo is removed (version NULL) a counter would restart at 1 and
  // reuse an earlier URL that other devices have cached forever, so they'd keep showing the old photo.
  const version = Math.max(Date.now(), (p.photo_version ?? 0) + 1);
  await db.batch([
    db.prepare('INSERT OR REPLACE INTO photos (name, content_type, data) VALUES (?, ?, ?)').bind(`${id}-${version}`, contentType, bytes),
    db.prepare('UPDATE players SET photo_version = ? WHERE id = ?').bind(version, id),
    db.prepare('DELETE FROM photos WHERE name = ?').bind(`${id}-${p.photo_version ?? 0}`),
  ]);
  return json(playerDto(await loadPlayer(db, id)));
});

route('DELETE', 'players/:id/photo', 'admin', async ({ db, params }) => {
  const id = guid(params[0], 'id');
  const p = await loadPlayer(db, id);
  await db.batch([
    db.prepare('DELETE FROM photos WHERE name = ?').bind(`${id}-${p.photo_version ?? 0}`),
    db.prepare('UPDATE players SET photo_version = NULL WHERE id = ?').bind(id),
  ]);
  return json(playerDto(await loadPlayer(db, id)));
});

/** Public photo read. Names are versioned, so they can be cached forever. */
routes.push({
  method: 'GET',
  pattern: /^\/api\/photos\/([0-9a-f-]{36}-\d+)$/,
  access: 'public',
  handler: async ({ db, params }) => {
    const row = await db.prepare('SELECT content_type, data FROM photos WHERE name = ?').bind(params[0]).first<{ content_type: string; data: ArrayBuffer | number[] }>();
    if (!row) return new Response('Not found', { status: 404 });
    return new Response(new Uint8Array(row.data as ArrayBuffer), {
      headers: { 'Content-Type': row.content_type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
    });
  },
});

// ---- sessions --------------------------------------------------------------------------------------

interface SessionRow {
  id: string;
  date: string;
  notes: string | null;
  status: 'open' | 'closed';
  created_at: string;
}
interface TeamRow {
  id: string;
  session_id: string;
  label: string;
  color: string;
  sort_order: number;
}
interface RosterRow {
  player_id: string;
  team_id: string | null;
  position: number | null;
  is_bench: number;
}
interface GameRow {
  id: string;
  session_id: string;
  team_a_id: string;
  team_b_id: string;
  score_a: number;
  score_b: number;
  mvp_player_id: string;
  played_at: string;
  created_at: string;
}
interface PartRow {
  game_id: string;
  player_id: string;
  side: Side;
  position: number;
}

function gameDtos(games: GameRow[], parts: PartRow[]) {
  const byGame = new Map<string, PartRow[]>();
  for (const p of parts) {
    let l = byGame.get(p.game_id);
    if (!l) byGame.set(p.game_id, (l = []));
    l.push(p);
  }
  return games.map((g) => ({
    id: g.id,
    sessionId: g.session_id,
    teamAId: g.team_a_id,
    teamBId: g.team_b_id,
    scoreA: g.score_a,
    scoreB: g.score_b,
    mvpPlayerId: g.mvp_player_id,
    playedAt: g.played_at,
    createdAt: g.created_at,
    participants: (byGame.get(g.id) ?? [])
      .sort((x, y) => (x.side < y.side ? -1 : x.side > y.side ? 1 : x.position - y.position))
      .map((p) => ({ playerId: p.player_id, side: p.side, position: p.position })),
  }));
}

async function loadSessionDetail(db: D1Database, id: string) {
  const [s, teams, players, games, parts] = await db.batch([
    db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id),
    db.prepare('SELECT * FROM session_teams WHERE session_id = ? ORDER BY sort_order').bind(id),
    db.prepare('SELECT player_id, team_id, position, is_bench FROM session_players WHERE session_id = ?').bind(id),
    db.prepare('SELECT * FROM games WHERE session_id = ? ORDER BY played_at, created_at').bind(id),
    db.prepare('SELECT p.* FROM game_participants p JOIN games g ON g.id = p.game_id WHERE g.session_id = ?').bind(id),
  ]);
  const session = (s.results as SessionRow[])[0];
  if (!session) throw notFound('session');
  return {
    id: session.id,
    date: session.date,
    notes: session.notes,
    status: session.status,
    teams: (teams.results as TeamRow[]).map((t) => ({ id: t.id, label: t.label, color: t.color, sortOrder: t.sort_order })),
    players: (players.results as RosterRow[]).map((p) => ({ playerId: p.player_id, teamId: p.team_id, position: p.position, isBench: !!p.is_bench })),
    games: gameDtos(games.results as GameRow[], parts.results as PartRow[]).map(({ createdAt: _c, ...g }) => g),
  };
}

route('GET', 'sessions', 'public', async ({ db }) => {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.date, s.notes, s.status,
         (SELECT COUNT(*) FROM session_players p WHERE p.session_id = s.id AND p.is_bench = 0) AS player_count,
         (SELECT COUNT(*) FROM session_players p WHERE p.session_id = s.id AND p.is_bench = 1) AS bench_count,
         (SELECT COUNT(*) FROM session_teams t WHERE t.session_id = s.id) AS team_count,
         (SELECT COUNT(*) FROM games g WHERE g.session_id = s.id) AS game_count
       FROM sessions s ORDER BY s.date DESC, s.created_at DESC`,
    )
    .all<SessionRow & { player_count: number; bench_count: number; team_count: number; game_count: number }>();
  return json(
    results.map((s) => ({
      id: s.id,
      date: s.date,
      notes: s.notes,
      status: s.status,
      playerCount: s.player_count,
      benchCount: s.bench_count,
      teamCount: s.team_count,
      gameCount: s.game_count,
    })),
  );
});

route('GET', 'sessions/:id', 'public', async ({ db, params }) => json(await loadSessionDetail(db, guid(params[0], 'id'))));

interface SessionInput {
  date?: unknown;
  notes?: unknown;
  status?: unknown;
}
function validateSession(input: SessionInput) {
  const errs: ValidationError[] = [];
  if (typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(input.date)))
    errs.push({ code: 'session.dateRequired', message: 'Date is required.' });
  const notes = str(input.notes);
  if (notes && notes.length > 500) errs.push({ code: 'session.notesTooLong', message: 'Notes must be at most 500 characters.' });
  if (input.status != null && input.status !== 'open' && input.status !== 'closed')
    errs.push({ code: 'session.statusInvalid', message: 'Status must be open or closed.' });
  throwIfInvalid(errs);
  return { date: input.date as string, notes: str(input.notes)?.trim() || null, status: (input.status as 'open' | 'closed' | null) ?? null };
}

route('POST', 'sessions', 'judge', async ({ db, req }) => {
  const s = validateSession(await body<SessionInput>(req));
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO sessions (id, date, notes, status, created_at) VALUES (?, ?, ?, 'open', ?)").bind(id, s.date, s.notes, now()),
    bump(db),
  ]);
  return json(await loadSessionDetail(db, id), 201);
});

route('PUT', 'sessions/:id', 'judge', async ({ db, req, params, admin }) => {
  const id = guid(params[0], 'id');
  const s = validateSession(await body<SessionInput>(req));
  await requireOpenForJudge(db, admin, id);
  if (admin!.role === 'judge' && s.status === 'closed') throw new ApiException(403, 'auth.adminOnly', 'Only admins can close or reopen a session.');
  const res = await db.batch([
    db.prepare('UPDATE sessions SET date = ?, notes = ?, status = COALESCE(?, status) WHERE id = ?').bind(s.date, s.notes, s.status, id),
    bump(db),
  ]);
  if (!res[0].meta.changes) throw notFound('session');
  return json(await loadSessionDetail(db, id));
});

route('DELETE', 'sessions/:id', 'admin', async ({ db, params }) => {
  const id = guid(params[0], 'id');
  await db.batch([
    db.prepare('DELETE FROM game_ratings WHERE game_id IN (SELECT id FROM games WHERE session_id = ?)').bind(id),
    db.prepare('DELETE FROM game_participants WHERE game_id IN (SELECT id FROM games WHERE session_id = ?)').bind(id),
    db.prepare('DELETE FROM games WHERE session_id = ?').bind(id),
    db.prepare('DELETE FROM session_players WHERE session_id = ?').bind(id),
    db.prepare('DELETE FROM session_teams WHERE session_id = ?').bind(id),
    db.prepare('DELETE FROM sessions WHERE id = ?').bind(id),
    bump(db),
  ]);
  return noContent();
});

/**
 * Replaces the session roster: who is checked in, the teams, and the base lineup (team + position or
 * bench). With no teams this is plain check-in. Applied as one atomic batch.
 */
route('PUT', 'sessions/:id/roster', 'judge', async ({ db, req, params, admin }) => {
  const id = guid(params[0], 'id');
  await requireOpenForJudge(db, admin, id);
  const raw = await body<{ teams?: unknown; players?: unknown }>(req);
  const input: RosterInput = {
    teams: (Array.isArray(raw.teams) ? raw.teams : []).map((t: Record<string, unknown>) => ({
      id: guid(t?.id, 'teams.id'),
      label: str(t?.label)?.trim().slice(0, 40) ?? '',
      color: str(t?.color) ?? '',
    })),
    players: (Array.isArray(raw.players) ? raw.players : []).map((p: Record<string, unknown>) => ({
      playerId: guid(p?.playerId, 'players.playerId'),
      teamId: p?.teamId == null ? null : guid(p.teamId, 'players.teamId'),
      position: p?.position == null ? null : (p.position as number),
      isBench: p?.isBench === true,
    })),
  };

  const [sess, gameRows, partRows, known, otherTeams, settingsRow] = await db.batch([
    db.prepare('SELECT id FROM sessions WHERE id = ?').bind(id),
    db.prepare('SELECT team_a_id, team_b_id FROM games WHERE session_id = ?').bind(id),
    db.prepare('SELECT DISTINCT p.player_id FROM game_participants p JOIN games g ON g.id = p.game_id WHERE g.session_id = ?').bind(id),
    db.prepare('SELECT id FROM players'),
    db.prepare(`SELECT id FROM session_teams WHERE session_id != ? AND id IN (SELECT value FROM json_each(?))`).bind(id, JSON.stringify(input.teams.map((t) => t.id))),
    db.prepare('SELECT json FROM app_settings WHERE id = 1'),
  ]);
  if (!sess.results.length) throw notFound('session');
  const teamsUsed = new Set((gameRows.results as { team_a_id: string; team_b_id: string }[]).flatMap((g) => [g.team_a_id, g.team_b_id]));
  const withGames = new Set((partRows.results as { player_id: string }[]).map((p) => p.player_id));
  const knownIds = new Set((known.results as { id: string }[]).map((p) => p.id));
  const settings = parseSettings((settingsRow.results as { json: string }[])[0]?.json);

  const errors = validateRoster(input, settings, knownIds, withGames, teamsUsed);
  if (otherTeams.results.length) errors.push({ code: 'roster.unknownTeam', message: 'Team belongs to another session.' });
  throwIfInvalid(errors);

  const at = now();
  const keep = JSON.stringify(input.teams.map((t) => t.id));
  await db.batch([
    db.prepare('DELETE FROM session_players WHERE session_id = ?').bind(id),
    db.prepare('DELETE FROM session_teams WHERE session_id = ? AND id NOT IN (SELECT value FROM json_each(?))').bind(id, keep),
    ...input.teams.map((t, i) =>
      db
        .prepare(
          `INSERT INTO session_teams (id, session_id, label, color, sort_order) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET label = excluded.label, color = excluded.color, sort_order = excluded.sort_order`,
        )
        .bind(t.id, id, t.label, t.color, i),
    ),
    ...input.players.map((p) =>
      db
        .prepare('INSERT INTO session_players (session_id, player_id, team_id, position, is_bench, checked_in_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, p.playerId, p.teamId, p.isBench ? null : p.position, p.isBench ? 1 : 0, at),
    ),
    bump(db),
  ]);
  return json(await loadSessionDetail(db, id));
});

// ---- games -----------------------------------------------------------------------------------------

interface GameRequest {
  sessionId?: unknown;
  teamAId?: unknown;
  teamBId?: unknown;
  scoreA?: unknown;
  scoreB?: unknown;
  mvpPlayerId?: unknown;
  playedAt?: unknown;
  participants?: unknown;
}

/**
 * Idempotent upsert keyed by the client-generated id: replaying a queued offline submission is safe.
 * Derived stats are recomputed from the full history on read, so nothing else needs updating.
 */
route('PUT', 'games/:id', 'judge', async ({ db, req, params, admin }) => {
  const id = guid(params[0], 'id');
  const b = await body<GameRequest>(req);
  const sessionId = guid(b.sessionId, 'sessionId');
  await requireOpenForJudge(db, admin, sessionId);
  const participants: GameParticipantInput[] = (Array.isArray(b.participants) ? b.participants : []).map((p: Record<string, unknown>) => ({
    playerId: guid(p?.playerId, 'participants.playerId'),
    side: str(p?.side) ?? '',
    position: p?.position as number,
  }));
  const input = {
    id,
    sessionId,
    teamAId: guid(b.teamAId, 'teamAId'),
    teamBId: guid(b.teamBId, 'teamBId'),
    scoreA: b.scoreA as number,
    scoreB: b.scoreB as number,
    mvpPlayerId: guid(b.mvpPlayerId, 'mvpPlayerId'),
    participants,
  };
  const playedAt = b.playedAt != null ? isoDateTime(b.playedAt, 'playedAt') : null;

  const [sess, teams, roster, existing, settingsRow] = await db.batch([
    db.prepare('SELECT id FROM sessions WHERE id = ?').bind(sessionId),
    db.prepare('SELECT id FROM session_teams WHERE session_id = ?').bind(sessionId),
    db.prepare('SELECT player_id FROM session_players WHERE session_id = ?').bind(sessionId),
    db.prepare('SELECT session_id, played_at FROM games WHERE id = ?').bind(id),
    db.prepare('SELECT json FROM app_settings WHERE id = 1'),
  ]);
  if (!sess.results.length) throw notFound('session');
  throwIfInvalid(
    validateGame(
      input,
      parseSettings((settingsRow.results as { json: string }[])[0]?.json),
      new Set((teams.results as { id: string }[]).map((t) => t.id)),
      new Set((roster.results as { player_id: string }[]).map((p) => p.player_id)),
    ),
  );
  const prev = (existing.results as { session_id: string; played_at: string }[])[0];
  if (prev && prev.session_id !== sessionId) throw new ApiException(409, 'game.sessionMismatch', "A game can't be moved to another session.");

  const at = now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO games (id, session_id, team_a_id, team_b_id, score_a, score_b, mvp_player_id, played_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id,
           score_a = excluded.score_a, score_b = excluded.score_b, mvp_player_id = excluded.mvp_player_id,
           played_at = COALESCE(?, games.played_at)`,
      )
      .bind(id, sessionId, input.teamAId, input.teamBId, input.scoreA, input.scoreB, input.mvpPlayerId, playedAt ?? at, at, playedAt),
    db.prepare('DELETE FROM game_participants WHERE game_id = ?').bind(id),
    ...participants.map((p) =>
      db.prepare('INSERT INTO game_participants (game_id, player_id, side, position) VALUES (?, ?, ?, ?)').bind(id, p.playerId, p.side, p.position),
    ),
    bump(db),
  ]);

  const [g, parts] = await db.batch([
    db.prepare('SELECT * FROM games WHERE id = ?').bind(id),
    db.prepare('SELECT * FROM game_participants WHERE game_id = ?').bind(id),
  ]);
  const { createdAt: _c, ...dto } = gameDtos(g.results as GameRow[], parts.results as PartRow[])[0];
  return json(dto, prev ? 200 : 201);
});

/** All games with lineups, oldest first (public; used for CSV export). */
route('GET', 'games', 'public', async ({ db }) => {
  const [g, p] = await db.batch([db.prepare('SELECT * FROM games ORDER BY played_at, created_at'), db.prepare('SELECT * FROM game_participants')]);
  return json(gameDtos(g.results as GameRow[], p.results as PartRow[]).map(({ createdAt: _c, ...x }) => x));
});

route('DELETE', 'games/:id', 'judge', async ({ db, params, admin }) => {
  const id = guid(params[0], 'id');
  const g = await db.prepare('SELECT session_id FROM games WHERE id = ?').bind(id).first<{ session_id: string }>();
  if (g) await requireOpenForJudge(db, admin, g.session_id);
  await db.batch([
    db.prepare('DELETE FROM game_ratings WHERE game_id = ?').bind(id),
    db.prepare('DELETE FROM game_participants WHERE game_id = ?').bind(id),
    db.prepare('DELETE FROM games WHERE id = ?').bind(id),
    bump(db),
  ]);
  return noContent();
});

/**
 * A judge's 1-5 star rating of one player's performance in one game (asked right after saving it).
 * Upsert keyed by game + player, so an offline replay is harmless. Blended into ratings on read.
 */
route('PUT', 'games/:id/ratings/:id', 'judge', async ({ db, req, params, admin }) => {
  const gameId = guid(params[0], 'gameId');
  const playerId = guid(params[1], 'playerId');
  const { stars } = await body<{ stars?: unknown }>(req);
  if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5)
    throwIfInvalid([{ code: 'rating.stars', message: 'Stars must be a whole number from 1 to 5.' }]);
  const [g, part] = await db.batch([
    db.prepare('SELECT session_id FROM games WHERE id = ?').bind(gameId),
    db.prepare('SELECT 1 AS x FROM game_participants WHERE game_id = ? AND player_id = ?').bind(gameId, playerId),
  ]);
  const game = (g.results as { session_id: string }[])[0];
  if (!game) throw notFound('game');
  if (!part.results.length) throwIfInvalid([{ code: 'rating.notInGame', message: 'That player did not play in this game.' }]);
  await requireOpenForJudge(db, admin, game.session_id);
  await db.batch([
    db
      .prepare(
        `INSERT INTO game_ratings (game_id, player_id, stars, rated_by, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (game_id, player_id) DO UPDATE SET stars = excluded.stars, rated_by = excluded.rated_by, created_at = excluded.created_at`,
      )
      .bind(gameId, playerId, stars, admin!.id, now()),
    bump(db),
  ]);
  return noContent();
});

// ---- analytics & settings --------------------------------------------------------------------------

/**
 * Every derived number recomputed from the full game history. Optional `from`/`to` (ISO) limit the
 * counting stats to a window; ratings always use the full history. The JSON is cached in D1 for the
 * current data version, so repeated reads between writes cost one row lookup.
 */
route('GET', 'analytics', 'public', async ({ db, url }) => {
  const from = url.searchParams.get('from') ? isoDateTime(url.searchParams.get('from'), 'from') : null;
  const to = url.searchParams.get('to') ? isoDateTime(url.searchParams.get('to'), 'to') : null;
  const key = `${from ?? ''}|${to ?? ''}`;

  const cached = await db
    .prepare('SELECT c.json FROM analytics_cache c JOIN meta m ON m.id = 1 AND c.version = m.data_version WHERE c.key = ?')
    .bind(key)
    .first<{ json: string }>();
  if (cached) return new Response(cached.json, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Cache': 'hit' } });

  const [meta, players, games, parts, settingsRow, ratings] = await db.batch([
    db.prepare('SELECT data_version FROM meta WHERE id = 1'),
    db.prepare('SELECT id FROM players'),
    db.prepare('SELECT id, session_id, played_at, created_at, score_a, score_b, mvp_player_id FROM games'),
    db.prepare('SELECT game_id, player_id, side, position FROM game_participants'),
    db.prepare('SELECT json FROM app_settings WHERE id = 1'),
    db.prepare('SELECT game_id, player_id, stars FROM game_ratings'),
  ]);
  const ratingsByGame = new Map<string, { playerId: string; stars: number }[]>();
  for (const r of ratings.results as { game_id: string; player_id: string; stars: number }[]) {
    let l = ratingsByGame.get(r.game_id);
    if (!l) ratingsByGame.set(r.game_id, (l = []));
    l.push({ playerId: r.player_id, stars: r.stars });
  }
  const version = (meta.results as { data_version: number }[])[0]?.data_version ?? 0;
  const byGame = new Map<string, GameRecord['participants']>();
  for (const p of parts.results as PartRow[]) {
    let l = byGame.get(p.game_id);
    if (!l) byGame.set(p.game_id, (l = []));
    l.push({ playerId: p.player_id, side: p.side, position: p.position });
  }
  const records: GameRecord[] = (games.results as GameRow[]).map((g) => ({
    id: g.id,
    sessionId: g.session_id,
    playedAt: g.played_at,
    createdAt: g.created_at,
    scoreA: g.score_a,
    scoreB: g.score_b,
    mvpPlayerId: g.mvp_player_id,
    participants: byGame.get(g.id) ?? [],
    judgeRatings: ratingsByGame.get(g.id),
  }));
  const result = compute(
    (players.results as { id: string }[]).map((p) => p.id),
    records,
    parseSettings((settingsRow.results as { json: string }[])[0]?.json),
    from,
    to,
  );
  const text = JSON.stringify(result);
  try {
    await db.batch([
      db.prepare('INSERT OR REPLACE INTO analytics_cache (key, version, json) VALUES (?, ?, ?)').bind(key, version, text),
      db.prepare('DELETE FROM analytics_cache WHERE version < ?').bind(version),
    ]);
  } catch (e) {
    console.warn('analytics cache write failed', e);
  }
  return new Response(text, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Cache': 'miss' } });
});

route('GET', 'settings', 'public', async ({ db }) => json(await getSettings(db)));

route('PUT', 'settings', 'admin', async ({ db, req }) => {
  const raw = await body<Partial<GroupSettings>>(req);
  const s = normalizeSettings(raw);
  throwIfInvalid(validateSettings(s));
  const clean: GroupSettings = {
    positionTemplate: s.positionTemplate.filter(isValidPosition),
    allowedTeamCounts: s.allowedTeamCounts,
    targetScore: s.targetScore,
    winByTwo: s.winByTwo,
    provisionalGames: s.provisionalGames,
    minPositionGames: s.minPositionGames,
    minChemistryGames: s.minChemistryGames,
    goldThreshold: s.goldThreshold,
    silverThreshold: s.silverThreshold,
  };
  await db.batch([
    db
      .prepare('INSERT INTO app_settings (id, json, updated_at) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at')
      .bind(JSON.stringify(clean), now()),
    bump(db),
  ]);
  return json(clean);
});

// ---- auth & admins ---------------------------------------------------------------------------------

const meDto = (a: { id: string; name: string; role: Role } | null) => ({
  signedIn: !!a,
  isAdmin: a?.role === 'admin',
  role: a?.role ?? null,
  name: a?.name ?? null,
  id: a?.id ?? null,
});
route('GET', 'me', 'public', async ({ admin }) => json(meDto(admin)));

/** Exchanges a personal admin code for a session cookie. */
route('POST', 'auth/login', 'public', async ({ db, req }) => {
  if (!sameOrigin(req)) return errorResponse(403, 'auth.forbidden', 'Cross-site requests are not allowed.');
  const { code } = await body<{ code?: unknown }>(req);
  const c = str(code)?.trim();
  const found = c && c.length >= 16 && c.length <= 200 ? await db.prepare('SELECT id, name, role FROM admins WHERE code_hash = ?').bind(await sha256(c)).first<{ id: string; name: string; role: Role }>() : null;
  if (!found) return errorResponse(401, 'auth.invalidCode', 'This sign-in link is not valid (it may have been replaced).');
  const token = randomToken(32);
  const at = new Date();
  await db.batch([
    db.prepare('INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), found.id, new Date(at.getTime() + SESSION_DAYS * 864e5).toISOString()),
    db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').bind(at.toISOString()),
  ]);
  return json(meDto(found), 200, { 'Set-Cookie': sessionCookie(req, token) });
});

route('POST', 'auth/logout', 'public', async ({ db, req, admin }) => {
  if (admin) await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(admin.tokenHash).run();
  return noContent({ 'Set-Cookie': sessionCookie(req, null) });
});

route('GET', 'admins', 'admin', async ({ db, admin }) => {
  const { results } = await db
    .prepare("SELECT id, name, role, created_at FROM admins ORDER BY role = 'judge', created_at")
    .all<{ id: string; name: string; role: Role; created_at: string }>();
  return json(results.map((a) => ({ id: a.id, name: a.name, role: a.role, createdAt: a.created_at, isYou: a.id === admin!.id })));
});

function adminName(v: unknown) {
  const name = str(v)?.trim();
  if (!name) throwIfInvalid([{ code: 'admin.nameRequired', message: 'Name is required.' }]);
  return name!.slice(0, 60);
}

/** Creates an admin or judge and returns their sign-in code once (never retrievable again). */
route('POST', 'admins', 'admin', async ({ db, req }) => {
  const { name, role } = await body<{ name?: unknown; role?: unknown }>(req);
  const r: Role = role === 'judge' ? 'judge' : 'admin';
  const id = crypto.randomUUID();
  const code = randomToken(24);
  await db.prepare('INSERT INTO admins (id, name, role, code_hash, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, adminName(name), r, await sha256(code), now()).run();
  return json({ id, code }, 201);
});

/** New link for an admin (lost phone, leaked link): the old link stops working and their devices are signed out. */
route('POST', 'admins/:id/code', 'admin', async ({ db, params }) => {
  const id = guid(params[0], 'id');
  const code = randomToken(24);
  const res = await db.batch([
    db.prepare('UPDATE admins SET code_hash = ? WHERE id = ?').bind(await sha256(code), id),
    db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').bind(id),
  ]);
  if (!res[0].meta.changes) throw notFound('admin');
  return json({ id, code });
});

route('DELETE', 'admins/:id', 'admin', async ({ db, params }) => {
  const id = guid(params[0], 'id');
  const target = await db.prepare('SELECT role FROM admins WHERE id = ?').bind(id).first<{ role: Role }>();
  const count = await db.prepare("SELECT COUNT(*) AS n FROM admins WHERE role = 'admin'").first<{ n: number }>();
  if (target?.role === 'admin' && (count?.n ?? 0) <= 1) throw new ApiException(409, 'admin.last', "You can't remove the last admin.");
  await db.prepare('DELETE FROM admins WHERE id = ?').bind(id).run();
  return noContent();
});

