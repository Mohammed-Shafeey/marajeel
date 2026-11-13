-- Judges: a second role that can run sessions (create, check-in, teams, record/edit/delete games) but
-- can't touch players, settings, other admins, or close/reopen/delete sessions.
ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'judge'));

-- Post-game star ratings (1–5) of one player's performance in one game, asked after the game is saved.
-- They nudge that player's rating in the analytics replay (see worker/src/core/analytics.ts).
CREATE TABLE game_ratings (
  game_id    TEXT NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  player_id  TEXT NOT NULL REFERENCES players (id),
  stars      INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  rated_by   TEXT,            -- admins.id of the rater (no FK: ratings outlive a removed judge)
  created_at TEXT NOT NULL,
  PRIMARY KEY (game_id, player_id)
);
CREATE INDEX ix_game_ratings_player ON game_ratings (player_id);
