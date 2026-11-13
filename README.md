# طائرة المراجيل · Al-Marajeel Volleyball

A small, mobile-first PWA for a weekly recreational volleyball group (~30 players). Check players in,
split them into balanced teams, record each game's score and MVP from the court side, and get
TrueSkill ratings, per-position ratings, chemistry, streaks, head-to-head, leaderboards and a dream team.
Arabic-first (RTL) with an English toggle.

Runs entirely on Cloudflare's free plan: one **Worker** serves the built PWA and the JSON API, and **D1**
(SQLite) stores everything, including player photos.

```
web/              React + Vite + TypeScript + Tailwind PWA (dnd-kit, TanStack Query, i18next)
worker/
  src/index.ts    The API: routes, admin checks, D1 queries
  src/auth.ts     Admin sign-in links and session cookies
  src/core/       TrueSkill, analytics replay, validation, settings, demo simulator (pure TS, no I/O)
  migrations/     D1 schema (SQL)
  test/           Vitest tests (ratings, chemistry, streaks, head-to-head, validation, simulation)
scripts/          seed.ts (demo data) and admin.ts (create an admin sign-in link)
wrangler.jsonc    Worker + static assets + D1 binding
design/           Design language from Claude Design (tokens, component CSS, boards)
.github/          CI: test → build → deploy
```

## Local development

Prerequisites: Node 22+ (the scripts in `scripts/` run TypeScript directly with Node).

```bash
npm install
npm --prefix web install
npm run db:migrate:local      # create the local D1 database (under .wrangler/)
npm run seed                  # optional: 30 fake players + ~15 simulated sessions
node scripts/admin.ts "Your name"   # local admin; the sign-in link goes to admin-links.local.txt
npm run dev                   # Worker on :8787 + Vite on :5173
```

Open **http://localhost:5173**, then open the link from `admin-links.local.txt` to become an admin.
Without signing in, everything is read-only.

**Tests**

```bash
npm test                 # worker tests + web tests
npm run typecheck        # worker type-check (web is type-checked by its build)
```

## Deployment (Cloudflare, free plan)

First time, from this folder:

```bash
npx wrangler login                       # opens the browser; sign in to Cloudflare
npx wrangler d1 create marajeel          # copy the printed database_id into wrangler.jsonc
npm run deploy                           # build, apply migrations to the live DB, deploy
node scripts/admin.ts "Your name" --remote --url https://<your-worker>.workers.dev
```

The last command creates the first admin and writes their sign-in link to `admin-links.local.txt` (git-ignored).
The live database starts empty: add your real players in the app.

**Automatic deploys from GitHub** (optional): create a Cloudflare API token with the *Edit Cloudflare Workers* template
plus *D1: Edit*, then add repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Every push to
`main` then runs the tests, applies migrations and deploys. Without the secrets the deploy step is skipped.

## Admins and judges

Reading is public. Writing needs a signed-in admin or judge:

- **Admins** can change everything.
- **Judges** run sessions: they can start a new session and, while it is open, edit its check-in, teams and games (including deleting a game).
  They can't edit players or settings, manage admins, close/reopen a session, or delete one. Closed sessions are read-only for them.

- Each admin has a **personal sign-in link** (`/signin#<code>`). Opening it once signs that device in for 180 days.
  The code lives in the URL fragment, so it never reaches server logs, and the database stores only its SHA-256 hash.
- Admins add admins and judges under **Settings → Admins & judges**. The new link is shown once, to copy or share privately.
  From the command line: `node scripts/admin.ts "Name" --judge --remote --url …` creates a judge.
  **New link** replaces a lost or leaked link and signs that admin out everywhere. You can't remove the last admin.
- Every write route checks the session server-side (`worker/src/index.ts`), and also rejects cross-site requests.

## How ratings work

Games are the only source of truth. Every derived number is recomputed by replaying **all games in
chronological order** (`compute` in `worker/src/core/analytics.ts`) on each read. With hundreds of games that takes milliseconds, so
correcting a score or changing the algorithm keeps everything consistent. Nothing is updated incrementally.

**Judge star ratings.** After a new game is saved, the judge (or admin) is asked to rate one player on court with 1–5 stars:
the non-MVP with the fewest judge ratings so far (then fewest games). Skipping is fine. Each rating nudges that player's overall and
position μ by `gain·(stars−3)·β/2`, where `gain = σ²/(σ²+β²)`, applied right after that game in the replay. 3 stars changes nothing,
new players move most (a 5-star game ≈ +5 display points), established players ≈ +1–2, and σ is left alone so opinions never make a rating
look more certain than results do. The average and count show as **Judge score** on the player page.

- **Individual rating:** two-team TrueSkill (μ₀ = 25, σ₀ = 25/3, β = σ₀/2, τ = σ₀/100, no draws). This is an exact
  closed-form port that matches Moserware's `TwoTeamTrueSkillCalculator` (`worker/src/core/trueskill.ts`).
- **Score margin:** the update step is scaled by `1 + 0.5 · clamp((margin − 2) / 8, 0, 1)`, so a 2-point game counts 1.0×
  and a 10+ point blowout counts at most 1.5×.
- **Displayed 0–100 rating:** `clamp(round(40 + 1.5 · (μ − 3σ)), 0, 100)`. This is a conservative estimate: a new player
  shows 40 and climbs as the system grows confident. A strong established player shows about 80. Players with fewer than 5
  games are *provisional*.
- **Per-position rating:** a separate TrueSkill track per zone (1–6), updated only from games played at
  that zone. *Best position* is the highest-rated zone with at least 5 games there.
- **Chemistry** (per teammate pair): for each game together, take `result (1/0) − pre-game win probability`. Average those values, then
  shrink the average by `n / (n + 5)`. It's shown once a pair has at least 5 games together. The UI shows it ×20, i.e. as "rating points".
- **Team rating** (one function for the court, balancer and dream team, `web/src/lib/teamRating.ts`): the mean of each
  player's rating at their assigned position, plus `clamp(20 × mean pair chemistry, ±3)`. Provisional players count as the
  group average (the "prior").
- **Balancing:** a snake draft by position, then simulated annealing over swaps to minimise
  max − min + variance of team ratings (plus a small penalty for unfamiliar positions). It uses a seeded RNG, and *Shuffle* changes the seed.
- **Dream team:** keeps the top 6 eligible candidates per position, then searches every combination for the highest team rating.

## Changing the position template

By default each team fills zones **4 · 3 · 2** (front: left hitter, setter, right hitter) and **5 · 6 · 1**
(back: left receiver, libero, right receiver), one player each. An admin can change this under
**Settings → Game → Position template**. For example, untick 6 to play 5-a-side without a libero, and set the allowed
team counts (2 or 3 teams means 10 or 15 active players). Session check-in, lineup validation (client and server), the
balancer and the dream team all follow the template. The default lives in
`worker/src/core/settings.ts` and `web/src/api/types.ts` (`DEFAULT_SETTINGS`).

## Design

The visual language ("street-sport": concrete textures, slanted panels, FUT-style collectible cards) comes from
`design/marajeel-tokens.css` + `design/marajeel-components.css`. These are copied into `web/src/styles/` and mapped
into Tailwind in `web/tailwind.config.js`. The design boards are in `design/boards/`.
