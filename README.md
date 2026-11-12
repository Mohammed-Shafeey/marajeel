# طائرة المراجيل · Al-Marajeel Volleyball

A small, mobile-first PWA for a weekly recreational volleyball group (~30 players). Check players in,
split them into balanced teams, record each game's score and MVP from the court side, and get
TrueSkill ratings, per-position ratings, chemistry, streaks, head-to-head, leaderboards and a dream team.
Arabic-first (RTL) with an English toggle.

```
web/            React + Vite + TypeScript + Tailwind PWA (dnd-kit, TanStack Query, i18next)
api/
  Marajeel.Core   Domain, EF Core (Azure SQL), validation, TrueSkill + analytics replay, demo simulator
  Marajeel.Api    .NET 8 isolated Azure Functions (thin HTTP layer, admin checks)
  Marajeel.Seed   Seed tool: 30 fake players + ~15 simulated sessions
  Marajeel.Tests  xUnit tests (ratings, chemistry, streaks, head-to-head, validation, simulation)
infra/          Bicep (Static Web App, Azure SQL serverless free offer, Storage)
design/         Design language from Claude Design (tokens, component CSS, boards)
.github/        CI (test → build → deploy) and manual infra provisioning
```

## Local development

Prerequisites: Node 20+, .NET 8 SDK, and **either** Docker Desktop **or** SQL Server LocalDB (Windows).

```bash
npm install              # root: Azurite, SWA CLI, Functions Core Tools, concurrently
npm --prefix web install
```

**Database**, pick one:

- Docker: `docker compose up -d` starts SQL Server on `localhost,14333` and Azurite. Then copy
  `api/Marajeel.Api/local.settings.example.json` to `local.settings.json` (its connection string already points at the container).
- LocalDB (no Docker): copy the example file and set
  `SQL_CONNECTION` to `Server=(localdb)\MSSQLLocalDB;Database=marajeel;Trusted_Connection=True;TrustServerCertificate=True`.

Migrations run automatically when the API starts. To load demo data (and see how well ratings recover
the hidden "true" skills):

```bash
# bash; on PowerShell use $env:SQL_CONNECTION = "..."
SQL_CONNECTION="<same connection string>" npm run seed
```

**Run everything** (Azurite + Functions + Vite + SWA emulator with auth):

```bash
npm run dev
```

Open **http://localhost:4280**. To act as an admin locally, open
`http://localhost:4280/.auth/login/github`, then type a username and add `admin` on its own line in *User's roles*.
(Port 5173 is plain Vite; reads work there, but writes need the SWA auth header, so use 4280.)

**Tests**

```bash
npm test                 # dotnet test + vitest
```

## Deployment

1. **Provision Azure** (once): `az group create -n rg-marajeel -l westeurope`, then
   `az deployment group create -g rg-marajeel -f infra/main.bicep -p sqlAdminPassword='<strong password>'`,
   or run the *Provision infrastructure* workflow (needs OIDC secrets `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
   `AZURE_SUBSCRIPTION_ID`, plus `SQL_ADMIN_PASSWORD`).
2. **Deployment token**: in the portal, open the Static Web App, choose *Manage deployment token*, and save the token as the GitHub secret
   `AZURE_STATIC_WEB_APPS_API_TOKEN`.
3. **Push to `main`**: the *Test & deploy* workflow runs all tests, builds the PWA, publishes the API and uploads both.
4. **Admins**: in the Static Web App, go to *Role management*, choose *Invite*, pick a provider (GitHub, Microsoft or Google) and enter the person's
   username/email with role `admin`. Send them the invite link. Everyone else can read without signing in.

Writes are protected twice: `staticwebapp.config.json` limits non-GET `/api/*` to the `admin` role, and every
write function checks the `x-ms-client-principal` header itself (`api/Marajeel.Api/Infrastructure.cs`).

## How ratings work

Games are the only source of truth. Every derived number is recomputed by replaying **all games in
chronological order** (`AnalyticsEngine.Compute`) on each read. With hundreds of games that takes milliseconds, so
correcting a score or changing the algorithm keeps everything consistent. Nothing is updated incrementally.

- **Individual rating:** two-team TrueSkill (μ₀ = 25, σ₀ = 25/3, β = σ₀/2, τ = σ₀/100, no draws). This is an exact
  closed-form port that matches Moserware's `TwoTeamTrueSkillCalculator` (`TrueSkill.cs`).
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
`api/Marajeel.Core/Domain/GroupSettings.cs` and `web/src/api/types.ts` (`DEFAULT_SETTINGS`).

## Design

The visual language ("street-sport": concrete textures, slanted panels, FUT-style collectible cards) comes from
`design/marajeel-tokens.css` + `design/marajeel-components.css`. These are copied into `web/src/styles/` and mapped
into Tailwind in `web/tailwind.config.js`. The design boards are in `design/boards/`.
