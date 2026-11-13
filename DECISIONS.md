# Decisions

Judgment calls made while building, with the simplest reasonable interpretation chosen.

## Group-specific (agreed with the organiser)

- **Positions are court zones, one player each**: 1 right receiver, 2 right hitter, 3 setter, 4 left hitter,
  5 left receiver, 6 libero. There's no rotation. This replaces the brief's S/OH/MB/OPP template. The template is the list of
  zones each team fills, configurable in settings.
- **Active players must be exactly teams × template size** (12 or 18 by default). Extra arrivals go to the
  bench automatically (last arrivals first), and a long-press benches or un-benches anyone. Bench players are attached to a team and
  can be subbed into any single game.
- **Games are usually to 15.** The target and win-by-two are settings, used only as a soft "save anyway?" check.
  Scores stay free-form (deuce results like 17–15 are fine). The server enforces only rule 4 (non-negative, no ties, below 100).
- **All "enough games" thresholds are 5** (provisional, position, chemistry) and configurable.

## Architecture

- **Derived stats are computed on read**, not stored in snapshot tables. A full replay over a few hundred games
  takes milliseconds, so there's nothing to keep in sync. The `from`/`to` window ("this month") limits counting stats
  only; ratings always use the full history.
- **Hosting moved from Azure to Cloudflare** (Workers + D1) because Azure sign-up kept failing for the organiser. The
  original .NET/Azure SQL version is in git history (before the Cloudflare commit). Everything fits the free plan with no card:
  100k requests/day, 5 GB of D1 storage.
- **Analytics are cached per data version.** Every write bumps `meta.data_version`. `/api/analytics` stores its JSON in
  `analytics_cache` for that version, so repeat reads cost one row lookup and stay well inside the Workers free-plan CPU budget.
  The cache is disposable: deleting it just causes a recompute.
- **The rating replay runs in the Worker; team rating, balancing and the dream team run in the browser.** Team rating has to update live
  while you drag cards, so it lives in one TS function (`web/src/lib/teamRating.ts`) used by the court, the balancer
  and the dream team. The API serves the per-player and per-pair numbers it needs.
- **Photos are stored in D1** as BLOBs (~512 px WebP, or PNG from iPhones when the image has transparency; tens to hundreds of KB each) rather than R2, which needs a card on file to enable.
  They're served via `/api/photos/{id}-{version}` with immutable caching. Each upload bumps the version and deletes the old row.
- **Judges are a role on the same sign-in links** (`admins.role` = `admin` | `judge`). The router has three access levels
  (public / judge / admin); judges are further limited to open sessions, and only admins can close, reopen or delete one.
- **Admins sign in with personal links, not passwords or an identity provider.** Cloudflare Access (email codes)
  needs a card on file. Passwords would need slow hashing that doesn't fit the free CPU budget. A random 192-bit code
  needs only SHA-256, can be revoked or replaced per admin, and opening a link is the easiest flow on a phone.
- **The client encodes WebP**, falling back to JPEG where the browser can't encode WebP from a canvas (Safari). The server
  accepts both and stores the detected content type.
- **D1 migrations are applied by the deploy** (`wrangler d1 migrations apply --remote`) before the new Worker goes live.
- **TrueSkill is our own port**, about 100 lines with no dependency risk, rather than the unmaintained Moserware.Skills. For two teams the factor graph
  has an exact closed form, and it's covered by tests.
- **Local development is just `npm run dev`**: `wrangler dev` runs the Worker with a local SQLite copy of D1, so there's no Docker or database server.

## Ratings & stats

- **Judge star ratings are blended into the rating** (organiser's choice), as a small μ-only nudge sized by the player's uncertainty:
  `Δμ = σ²/(σ²+β²) · (stars−3) · β/2`. Stars are relative to the player's usual level (3 = as expected). σ is unchanged, so a rating
  can't tighten from opinions alone and a harsh judge can't move an established player much. One prompt per new game, for the
  non-MVP on court with the fewest judge ratings (then fewest games, then highest σ, then random). Ratings are stored per
  game + player (`game_ratings`), queued offline like game writes, and ignored if the lineup is later edited to drop that player.

- **0–100 mapping**: `40 + 1.5·(μ − 3σ)`, clamped. See the README.
- **Win probability from team ratings** (court/balancer): `Φ((n·Δ/1.5) / (√(2n)·√2·β))`, consistent with the display
  mapping. For 6-a-side, +1 team-rating point ≈ 58 %.
- **Chemistry is displayed ×20** ("rating points"), the same scale as the team-rating bonus. Lines on the court link only
  adjacent teammates (row neighbours + same column, at most 7 per team), as in the court spec.
- **Provisional players count as the group prior** (the mean rating of established players, or 60 when nobody is established yet) in
  team rating, balancing and win probability, so new players don't drag a team's rating down.
- **Streaks** are consecutive wins in chronological order. In a month window they only count games in that month.
- **Session MVP** (on the sessions list, and the volt "MVP" card) is the player with the most game MVPs in that session.
  Ties go to the higher rating.
- **Simulated recovery**: with ~50 games per player, the rating μ correlates with the hidden true skill at
  ρ ≈ 0.6. Balanced 6v6 games carry little information each, so this is expected. The test checks the average over 5 seeds is above 0.5.

## UX

- **Court geometry never mirrors in RTL.** It renders in a `dir="ltr"` box. On phones, team A (the first team) is at the bottom,
  nearest the thumb.
- **Interactions:** tap a player on the court to pick the MVP; drag (long-press 250 ms on touch) to swap; drag across the net
  to swap teams for that game; drag from "sub in" to bring a bench or resting player in. In the team builder,
  tap-then-tap also swaps, and a selected placed player can be locked to their team before auto-balancing.
- **Offline**: game writes (create, edit, delete) are queued in IndexedDB and replayed on reconnect, on start, and every 30 s.
  The server upserts by the client GUID, so replays are idempotent. If the server rejects a queued game (validation), it's dropped and
  a toast explains why. Other writes (players, rosters, settings) need a connection.
- **Display preferences** (language, digits, theme) are per device in localStorage. Group settings are in the DB and admin-only.
- **Default next matchup** with 3 teams: the winner of the last game stays on against the team that rested.
