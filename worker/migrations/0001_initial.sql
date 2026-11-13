-- Al-Marajeel schema (Cloudflare D1 / SQLite).
-- Times are ISO-8601 UTC strings (`2026-01-01T18:00:00.000Z`), which sort correctly as text.
-- Games are the source of truth; nothing derived is stored except a disposable analytics cache.

CREATE TABLE players (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  short_name         TEXT,
  photo_version      INTEGER,
  preferred_position INTEGER NOT NULL CHECK (preferred_position BETWEEN 1 AND 6),
  is_active          INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL
);
CREATE INDEX ix_players_name ON players (name);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,              -- yyyy-mm-dd
  notes      TEXT,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TEXT NOT NULL
);
CREATE INDEX ix_sessions_date ON sessions (date);

CREATE TABLE session_teams (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  color      TEXT NOT NULL CHECK (color IN ('a', 'b', 'c', 'd')),
  sort_order INTEGER NOT NULL
);
CREATE INDEX ix_session_teams_session ON session_teams (session_id);

-- Rule 1: (session, player) primary key → a player is on at most one team per session.
CREATE TABLE session_players (
  session_id    TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  player_id     TEXT NOT NULL REFERENCES players (id),
  team_id       TEXT REFERENCES session_teams (id),
  position      INTEGER,
  is_bench      INTEGER NOT NULL DEFAULT 0,
  checked_in_at TEXT NOT NULL,
  PRIMARY KEY (session_id, player_id)
);

CREATE TABLE games (
  id            TEXT PRIMARY KEY,         -- client-generated → idempotent offline replays
  session_id    TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  team_a_id     TEXT NOT NULL REFERENCES session_teams (id),
  team_b_id     TEXT NOT NULL REFERENCES session_teams (id),
  score_a       INTEGER NOT NULL,
  score_b       INTEGER NOT NULL,
  mvp_player_id TEXT NOT NULL REFERENCES players (id),
  played_at     TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX ix_games_session ON games (session_id);
CREATE INDEX ix_games_played_at ON games (played_at);

-- Rule 2: (game, player) primary key → a player appears at most once per game.
CREATE TABLE game_participants (
  game_id   TEXT NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players (id),
  side      TEXT NOT NULL CHECK (side IN ('A', 'B')),
  position  INTEGER NOT NULL CHECK (position BETWEEN 1 AND 6),
  PRIMARY KEY (game_id, player_id)
);

CREATE TABLE app_settings (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  json       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Player photos (WebP/JPEG, ~512px, a few tens of KB). Name = "{playerId}-{version}".
CREATE TABLE photos (
  name         TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  data         BLOB NOT NULL
);

-- Admins sign in with a personal random code (shared as a link). Only its SHA-256 is stored.
CREATE TABLE admins (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  code_hash  TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id   TEXT NOT NULL REFERENCES admins (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- Disposable cache of analytics JSON, valid only for the current data version.
CREATE TABLE meta (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  data_version INTEGER NOT NULL
);
INSERT INTO meta (id, data_version) VALUES (1, 1);

CREATE TABLE analytics_cache (
  key        TEXT PRIMARY KEY,
  version    INTEGER NOT NULL,
  json       TEXT NOT NULL
);
