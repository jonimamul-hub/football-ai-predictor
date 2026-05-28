# Football AI Predictor — System Documentation

> Auto-generated from full source read. Last updated: 2026-05-28.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Deployment](#deployment)
3. [Database Schema](#database-schema)
4. [Server API Endpoints](#server-api-endpoints)
5. [Scraper API Endpoints](#scraper-api-endpoints)
6. [AI Files & System Prompts](#ai-files--system-prompts)
7. [React Components](#react-components)
8. [Data Flow](#data-flow)
9. [Known Bugs & Issues](#known-bugs--issues)

---

## Architecture Overview

Three separate services, all deployed on Railway:

```
Browser (React SPA)
    │
    │  HTTPS (same-origin in prod, Vite proxy in dev)
    ▼
Node.js Server  ──── PostgreSQL (Railway managed DB)
 (Express 5)    ──── @anthropic-ai/sdk (Claude AI calls)
    │
    │  HTTP (SCRAPER_URL env var)
    ▼
Python Scraper
 (Flask + Gunicorn)
    │
    │  HTTPS
    ▼
365scores public API
(webws.365scores.com/web/)
```

| Layer | Tech | Railway service name |
|---|---|---|
| Frontend | React 19 + Vite 8 | served by Node.js (static) |
| Backend | Node.js + Express 5 | `football-ai-predictor` |
| Scraper | Python 3.11 + Flask | `artistic-creation` |
| Database | PostgreSQL | `Postgres` (postgres-volume) |

**Key environment variables on the Node.js service:**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (injected by Railway) |
| `ANTHROPIC_API_KEY` | Claude API key for all AI calls |
| `SCRAPER_URL` | Base URL of the Python scraper service |
| `PORT` | Port to listen on (injected by Railway, defaults to 3001 locally) |

---

## Deployment

### Root `railway.toml`
```toml
[build]
builder      = "nixpacks"
buildCommand = "cd client && npm install && npm run build"

[deploy]
startCommand        = "node server/index.js"
healthcheckPath     = "/health"
healthcheckTimeout  = 30
restartPolicyType   = "on_failure"
```

Nixpacks auto-runs `npm ci` at the repo root (installs server deps into `/app/node_modules`), then the `buildCommand` builds the React client. The `client/dist/` output is **gitignored** — Railway always builds it fresh.

### `scraper/railway.toml`
```toml
[build]
builder = "nixpacks"

[deploy]
startCommand    = "gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 60"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "on_failure"
```

Scraper uses `scraper/runtime.txt` (`python-3.11.9`) and `scraper/requirements.txt` (`flask>=3.0.0, requests>=2.31.0, gunicorn>=21.0.0`).

### Local Development
```bash
# Terminal 1 — backend
node server/index.js          # listens on :3001

# Terminal 2 — frontend (Vite dev server proxies /api → :3001)
cd client && npm run dev      # listens on :5173

# Terminal 3 — scraper (optional)
cd scraper && python app.py   # listens on :5001
```

---

## Database Schema

All tables created/migrated in `initDB()` inside `server/index.js`. Migrations are **idempotent** (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DO $$ BEGIN … EXCEPTION WHEN duplicate_object`).

### `leagues`

Stores the user's tracked leagues. One row per league.

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `country` | VARCHAR(100) | e.g. `"England"` |
| `name` | VARCHAR(100) | e.g. `"Premier League"` |
| `emoji` | VARCHAR(10) | Auto-detected from country name |
| `lbr_status` | VARCHAR(20) | `pending` → `running` → `done` / `failed` |
| `signal_count` | INTEGER | Number of signals referencing this league |
| `lbr_error` | TEXT | Last LBR error message if `lbr_status = 'failed'` |
| `search_query` | TEXT | LBR-verified fixture search phrase |
| `found_via_detail` | TEXT | First 5 web-search queries used by LBR (pipe-separated) |
| `competition_id` | INTEGER | 365scores competition ID (from scraper `/discover`) |
| `season_num` | INTEGER | 365scores current season number |
| `created_at` | TIMESTAMP | |

Unique constraint: `(country, name)`.

---

### `signals`

AI-generated or manually-added prediction signals. Shared across all leagues; the `leagues` array tracks which leagues a signal was seen in.

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `type` | VARCHAR(10) | `btts` or `draw` |
| `category` | VARCHAR(20) | `factor` or `stat` |
| `name` | TEXT | Signal description |
| `level` | VARCHAR(20) | `Ideal`, `Good`, `Weak`, `Dormant` |
| `note` | TEXT | WHY explanation / evidence |
| `leagues` | TEXT[] | Array of `"Country — LeagueName"` strings |
| `src` | VARCHAR(20) | `LBR` (AI-generated) or `Manual` (user-added) |
| `created_at` | TIMESTAMP | |

Unique constraint: `(type, category, name)`.

On upsert conflict: keeps the **better** level (Ideal > Good > Weak > Dormant), updates `note`, appends to `leagues` array if not already present.

---

### `history`

Saved predictions (from both Analysis and Recommendation modes).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `type` | VARCHAR(10) | `btts` or `draw` |
| `match_name` | VARCHAR(200) | `"Team A vs Team B"` |
| `league` | VARCHAR(200) | |
| `match_date` | VARCHAR(20) | `DD.MM.YYYY` |
| `verdict` | VARCHAR(20) | `YES`, `NO`, `SKIP-B`, `DRAW`, `NO_DRAW` |
| `source` | VARCHAR(10) | `REC` (recommendation) or `ANA` (analysis) |
| `status` | VARCHAR(20) | `pending`, `win`, `lose` |
| `score` | VARCHAR(10) | Final score e.g. `"2-1"` |
| `reasoning` | TEXT | AI reasoning text |
| `created_at` | TIMESTAMP | |

---

### `search_cache`

Caches fixture search results per date+league. TTL: indefinite (no auto-expiry in code).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `search_date` | VARCHAR(20) | `YYYY-MM-DD` |
| `league_key` | VARCHAR(200) | `"Country:LeagueName"` |
| `matches` | TEXT | JSON array of match objects |
| `round` | VARCHAR(100) | Round label from first match |
| `found_via` | TEXT | `scraper` or `web_search` |
| `created_at` | TIMESTAMP | |

Unique constraint: `(search_date, league_key)`. Upsert overwrites on conflict.

---

## Server API Endpoints

Base: `https://football-ai-predictor-production.up.railway.app`

All `/api/*` routes are JSON. The SPA fallback (`app.use`) serves `client/dist/index.html` for everything else.

---

### `GET /health`

Health check for Railway. Returns immediately (no DB dependency).

**Response:**
```json
{
  "status": "OK",
  "v": 14,
  "anthropic_key": "SET | MISSING",
  "scraper_url": "SET | MISSING"
}
```

---

### `GET /api/leagues`

Returns all leagues ordered by country then name.

**Response:**
```json
{ "leagues": [ { "id": 1, "country": "England", "name": "Premier League", "lbr_status": "done", "signal_count": 24, "competition_id": 1, ... } ] }
```

---

### `POST /api/leagues`

Add a new league. Triggers two background tasks:
1. `discoverCompetitionId()` — calls scraper `/discover` to find the 365scores `competition_id`
2. `runLBRForLeague()` — runs League-Based Research (AI web search) to generate signals

**Request:** `{ "country": "England", "name": "Premier League", "emoji": "🏴" }`

**Response:** `{ "success": true, "league": { ...row } }`

On duplicate `(country, name)`: resets `lbr_status` to `"pending"` and re-runs LBR.

---

### `DELETE /api/leagues/:id`

Deletes a league by ID. Does **not** delete associated signals (signals are shared).

---

### `GET /api/signals?type=btts|draw`

Returns all signals for a given type, split into `factors` and `stats`. Ordered by level quality (Ideal first) then name.

**Response:** `{ "factors": [...], "stats": [...] }`

---

### `POST /api/signals`

Manually add a signal.

**Request:** `{ "type": "btts", "category": "factor", "name": "...", "level": "Dormant" }`

On duplicate `(type, category, name)`: updates `level` only.

---

### `DELETE /api/signals/:id`

Delete a signal by ID.

---

### `POST /api/search`

Main fixture search. Implements a 3-tier priority cascade:

```
1. DB Cache    → if (search_date, league_key) hit → use immediately
2. Scraper     → if league has competition_id → fetch from 365scores
   (on-the-fly discover if competition_id missing)
3. Claude AI   → if scraper returns 0 matches → web search fallback
```

**Request:**
```json
{
  "date": "2026-05-28",
  "leagues": [ { "country": "England", "name": "Premier League" } ],
  "timezone": 4
}
```

**Response:** `{ "matches": [ { "match": "...", "league": "...", "date": "DD.MM.YYYY", "round": "...", "time": "...", "competition_id": 1 } ] }`

Scraper is called with `upcoming_only=true` (statusGroup == 1 = Not Started only).

Results are cached in `search_cache` with `found_via = 'scraper'` or `'web_search'`.

---

### `POST /api/analyze/btts`

Single-match BTTS analysis using AI #1 (Claude Sonnet). Loads all BTTS signals from DB and applies them to the specific match.

**Request:** `{ "match": "Liverpool vs Arsenal", "league": "Premier League", "date": "28.05.2026" }`

**Response:**
```json
{
  "verdict": "YES | NO | SKIP-B",
  "confidence": 72,
  "matched_signals": [ { "name": "...", "level": "Good", "note": "why it applies" } ],
  "reasoning": "2-3 sentence explanation"
}
```

---

### `POST /api/analyze/draw`

Single-match draw analysis. **Bug:** currently calls `analyzeBTTS()` (the BTTS function) instead of a dedicated draw analysis function — returns BTTS-style verdicts (YES/NO/SKIP-B) rather than DRAW/NO_DRAW/SKIP-B.

**Request/Response:** same shape as `/api/analyze/btts`.

---

### `POST /api/recommend/btts`

Selects top 3 BTTS picks from a list of candidate matches. Includes last 5 recent losses in context ("Council Memory") to improve calibration.

**Request:** `{ "matches": [ { "match": "...", "league": "...", "date": "..." } ] }`

**Response:**
```json
{
  "recommendations": [
    { "match": "...", "league": "...", "date": "...", "verdict": "YES", "confidence": 80, "matched_signals": [...], "reasoning": "..." }
  ]
}
```

---

### `POST /api/recommend/draw`

Same as `/api/recommend/btts` but for draws. Selects top **2** picks. Returns `verdict: "DRAW"`.

---

### `GET /api/history?type=btts|draw`

Returns last 100 history entries for a type, newest first. `type` is optional — omit to get all entries.

---

### `POST /api/history`

Save a prediction to history.

**Request:** `{ "type": "btts", "match_name": "...", "league": "...", "match_date": "DD.MM.YYYY", "verdict": "YES", "source": "REC|ANA", "reasoning": "..." }`

---

### `PATCH /api/history/:id`

Update a history entry's result after the match is played.

**Request:** `{ "score": "2-1", "status": "win | lose" }`

---

### `DELETE /api/history/:id`

Delete a history entry by ID.

---

## Scraper API Endpoints

Base URL: set via `SCRAPER_URL` env var on the Node.js service.

Python Flask service. All 365scores data passes through an in-process cache (5-minute TTL).

**`statusGroup` values from 365scores:**
- `1` = Not Started (upcoming)
- `2` = Live
- `3` = Half-time
- `4` = Finished
- `5` = Postponed
- `6` = Cancelled

---

### `GET /health`

**Response:** `{ "status": "ok", "source": "365scores", "v": 2 }`

---

### `GET /fixtures`

Main fixture fetch. The Node.js server calls this as its primary data source.

**Query params:**

| Param | Default | Notes |
|---|---|---|
| `date` | today | `YYYY-MM-DD` format required |
| `competition_ids` | (all) | Comma-separated integer IDs. Non-numeric values silently ignored |
| `upcoming_only` | `false` | If `true`, only returns matches with `statusGroup == 1` |

**Response:**
```json
{
  "matches": [
    {
      "match": "Home vs Away",
      "home_team": "...", "away_team": "...",
      "home_id": 123, "away_id": 456,
      "league": "...", "country": "...",
      "date": "DD.MM.YYYY", "time": "HH:MM",
      "round": "Round 38", "round_num": 38,
      "score": "2-1",
      "status": "Finished",
      "result": "H | A | D",
      "game_id": 789,
      "competition_id": 1,
      "season_num": 2025,
      "has_stats": true,
      "status_group": 4
    }
  ],
  "total": 10,
  "date": "2026-05-28"
}
```

---

### `GET /discover`

Finds a league's `competition_id` by scanning ±14 days of fixtures.

**Query params:** `name=Premier+League&country=Kazakhstan`

**Response:**
```json
{
  "competitions": [
    { "id": 5455, "name": "Premier League", "country": "Kazakhstan", "season_num": 2025 }
  ],
  "query": { "name": "premier league", "country": "kazakhstan" }
}
```

Scoring: exact name match = 3pts, partial = 2pts, each matching word = 1pt, country match = 1pt. Results sorted by score descending. Returns after finding first non-empty date scan.

---

### `GET /form`

Recent completed matches for a single team. Scans backwards up to 60 days in 3-day steps.

**Query params:** `competitor_id=29793&limit=5` (max limit: 10)

**Response:** `{ "form": [ { ...match_fields, "result": "W|L|D", "is_home": true } ], "competitor_id": "29793" }`

---

### `GET /h2h`

Head-to-head history between two teams. Scans backwards up to 90 days in 3-day steps.

**Query params:** `home_id=5936&away_id=73956&limit=8` (max limit: 20)

**Response:** `{ "h2h": [ ...matches ], "home_id": "5936", "away_id": "73956" }`

---

### `GET /standings`

Derived standings table for a competition from last 60 days of results.

**Query params:** `competition_id=5455`

**Response:**
```json
{
  "standings": [
    { "position": 1, "team": "...", "played": 10, "wins": 7, "draws": 2, "losses": 1,
      "goals_for": 20, "goals_against": 8, "goal_diff": 12, "points": 23 }
  ],
  "competition_id": "5455",
  "note": "Derived from last 60 days"
}
```

---

## AI Files & System Prompts

All AI calls use `@anthropic-ai/sdk`. Models used:

| File | Model | Role |
|---|---|---|
| `server/ai/lbr.js` | `claude-haiku-4-5-20251001` | League research (background, slow) |
| `server/ai/search.js` | `claude-haiku-4-5-20251001` | Fixture search fallback |
| `server/ai/btts.js` | `claude-sonnet-4-5-20250929` | BTTS predictions |
| `server/ai/draw.js` | `claude-sonnet-4-5-20250929` | Draw predictions |

---

### `server/ai/lbr.js` — League-Based Research (LBR)

**Triggered by:** `POST /api/leagues` (runs in background via `setImmediate`)

**Purpose:** Researches a newly-added league and produces `signals` — qualitative factors and measurable statistics that predict BTTS and Draw outcomes. Also produces a `fixture_query` for future fixture searches.

**Loop:** Up to 10 iterations. Uses `web_search` tool. Stops when valid JSON `{ btts, draw }` is extracted.

**System prompt summary:**
- Mission: find *WHY* results happen, not just statistics
- Signal types: Factors (qualitative) and Statistics (measurable thresholds)
- Levels: Ideal (>70% hit rate, 2+ seasons) → Good (55–70%) → Weak (40–55%) → Dormant (<40%)
- Rule: Never just report numbers — always explain the mechanism
- Search strategy: 4–7 searches, both current (2024/25) and previous (2023/24) season

**Output JSON shape:**
```json
{
  "btts": { "factors": [...], "stats": [...] },
  "draw": { "factors": [...], "stats": [...] },
  "fixture_query": "search phrase for finding this league's fixtures"
}
```

**Saved to DB:** Each signal is upserted into `signals` table. The `fixture_query` is saved as `leagues.search_query`. All web search queries used are saved to `leagues.found_via_detail`.

---

### `server/ai/search.js` — Search Agent (Fallback)

**Triggered by:** `POST /api/search` when scraper returns 0 matches for a league

**Purpose:** Finds fixture data via Claude web search when the 365scores scraper has no data.

**Loop:** Up to 12 iterations. Uses `web_search` tool.

**System prompt summary:**
- Role: fallback agent — scraper already failed, this is last resort
- Strategy: waterfall — if `search_query` hint exists for a league, start there; then try alternative terms
- Must find: round/matchday label, kick-off times, exact team names
- Output: JSON array only, no prose

**Output format:**
```json
[{ "match": "Home vs Away", "league": "...", "country": "...", "date": "DD.MM.YYYY", "round": "Matchday 12", "time": "20:45" }]
```

---

### `server/ai/btts.js` — BTTS Council (AI #1)

**Triggered by:**
- `POST /api/analyze/btts` → `analyzeBTTS()` — single match analysis
- `POST /api/recommend/btts` → `selectTopBTTS()` — top 3 picks from candidates

**System prompt summary (built dynamically from DB signals):**
- Mission: JUSTIFIED predictions for BOTH TEAMS SCORE
- Verdict rules:
  - `YES` = 1+ Ideal confirmed OR 2+ Good confirmed
  - `NO` = 1+ Ideal/Good clearly against BTTS
  - `SKIP-B` = conflicting/insufficient evidence
- Includes all current signals from DB (factors + stats) formatted as `[Level] name`
- In Recommendation mode: includes "Council Memory" (last 5 incorrect predictions) for calibration

**Analysis response shape:**
```json
{
  "verdict": "YES",
  "confidence": 72,
  "matched_signals": [{ "name": "...", "level": "Good", "note": "why it applies" }],
  "reasoning": "..."
}
```

**Recommendation response shape:** same but as an array, max 3 items, only YES verdicts.

---

### `server/ai/draw.js` — Draw Council (AI #1)

**Triggered by:** `POST /api/recommend/draw` → `selectTopDraw()`

**Note:** No `analyzeDraw()` function exists in this file. Single-match draw analysis (`POST /api/analyze/draw`) incorrectly reuses `analyzeBTTS()`.

**System prompt summary:**
- Mission: JUSTIFIED predictions for matches ending in DRAW
- Verdict rules:
  - `DRAW` = 1+ Ideal confirmed OR 2+ Good confirmed
  - `NO_DRAW` = strong evidence against draw (clear favourite, motivation asymmetry)
  - `SKIP-B` = conflicting/insufficient evidence
- Recommendation mode only (no analysis mode): selects top **2** picks

**Response shape:** same as BTTS but `verdict: "DRAW"`, max 2 items.

---

## React Components

All components live in `client/src/components/`. State flows top-down; global state (date, timezone, leagues) lives in `App.jsx`.

---

### `App.jsx`

Root component. Owns all global state.

**State:**
- `mainTab` — `'btts' | 'draw' | 'live'`
- `showLeagues` — boolean, toggles LeaguesPanel overlay
- `leagues` — array of league objects from DB (passed down to Recommendation)
- `searchDate` — `YYYY-MM-DD` string, auto-detected from browser timezone on first load
- `searchTz` — numeric UTC offset (e.g. `4` for UTC+4), auto-detected

**Renders:** `Topbar` + one of `LeaguesPanel` / `BTTSTab` / `DrawTab`

---

### `Topbar.jsx`

Sticky header bar. The **only place** in the entire app where the date and timezone can be edited.

**Props:** `mainTab`, `setMainTab`, `showLeagues`, `setShowLeagues`, `searchDate`, `setSearchDate`, `searchTz`, `setSearchTz`

**UI elements:**
- ⚽ Football AI logo
- `<input type="date">` — sets `searchDate` (YYYY-MM-DD)
- `<input type="text">` — sets `searchTz`, accepts `UTC+4`, `UTC-3`, `+4`, `4`, etc.
- Navigation buttons: 🔵 BTTS, 🟡 Draw, 🔴 Live
- 🏆 Leagues toggle button

**Timezone parsing:** `parseTzStr()` accepts `UTC+N`, `UTC-N`, `+N`, `-N`, or plain `N`. Valid range: -12 to +14. On blur, re-formats to `UTC+N` display.

---

### `BTTSTab.jsx`

Tab container for BTTS mode. Sections: Analysis → Recommendation → History → Data Config.

**Props:** `leagues`, `searchDate`, `searchTz`

Passes all three props down to child components.

---

### `DrawTab.jsx`

Tab container for Draw mode. Sections: Recommendation → History → Data Config. (No Analysis section — Draw has no single-match analysis UI.)

**Props:** `leagues`, `searchDate`, `searchTz`

---

### `SecNav.jsx`

Reusable horizontal section navigation (Analysis / Recommendation / History / Data Config tabs).

**Props:** `sections` (string array), `active` (string), `setActive` (function)

Capitalizes first letter of each section name.

---

### `Analysis.jsx`

Single-match BTTS analysis form. Manually enter match name + league, click Analyze.

**Props:** `type` (`'btts'` or `'draw'`), `searchDate` (YYYY-MM-DD from header)

**Stages:** `form` → `loading` → `result` → `error`

**Date handling:** Converts `searchDate` (YYYY-MM-DD) to display format (DD.MM.YYYY). Shows a read-only note "📅 DD.MM.YYYY · set in header" — no date input in this component.

**Result actions:**
- "← New Analysis" — resets form
- "↓ Move to History" — saves to DB via `POST /api/history` with `source: 'ANA'`

**Signal display:** If signals have `category` field, shows Factors and Statistics sections separately. Otherwise shows all as a flat "Signals" list.

---

### `Recommendation.jsx`

Automated multi-match recommendation flow.

**Props:** `type` (`'btts'` or `'draw'`), `leagues` (from DB), `searchDate` (YYYY-MM-DD), `searchTz` (number)

**Stages:** `idle` → `searching` → `analyzing` → `done` → `error`

**Flow:**
1. "Get Recommendations" button → calls `POST /api/search` (with raw `YYYY-MM-DD` date, NOT converted)
2. If matches found → calls `POST /api/recommend/btts` or `/recommend/draw`
3. Displays results; each match can be expanded to see signals + reasoning
4. "↓ Move to History" saves to DB and removes from visible list

**Sub-tabs:**
- TOP 3 / TOP 2 — shows AI picks
- Search Results — shows all raw matches returned by the scraper/AI search

**Date display:** `displayDate` (DD.MM.YYYY) and `displayTz` are computed for use in status/error messages only — no UI element displays them.

---

### `History.jsx`

Prediction history viewer and result tracker.

**Props:** `type` (`'btts'` or `'draw'`

**Features:**
- Stats bar: Total / Wins / Losses / Win Rate
- Filter pills: All / Pending / Win / Lose
- "Check All" button — marks all pending rows (see bug note below)
- Per-row "edit" button — inline score input + Win/Lose buttons
- Per-row delete (🗑) button with confirmation
- Loss rows expand on click to show original AI reasoning

**Source badges:** `ANA` (purple) for analysis-mode saves, `REC` (blue) for recommendation saves.

---

### `DataConfig.jsx`

View and manage the signals database for a prediction type.

**Props:** `type` (`'btts'` or `'draw'`

**Sub-tabs:**
- 📌 **Factors** — qualitative signals from LBR or manual entry. Shows level badge, name, source icon (📚 LBR / 👤 Manual), note, and league chips.
- 📊 **Statistics** — measurable threshold signals. Same display.
- 🔗 **Patterns** — static hardcoded data (BTTS only). Not from DB, not editable.

Manual signals are added with level `Dormant`. LBR signals show which leagues they were detected in.

---

### `LeaguesPanel.jsx`

League management panel (shown when 🏆 Leagues is active).

**Props:** `onLeagueChange` — callback to refresh league list in App.jsx

**Features:**
- Add country (text input + button)
- Collapsible country blocks showing leagues inside
- Add league per country (triggers LBR background job on save)
- Delete league (API call + optimistic UI)
- Delete country (deletes all its leagues)
- LBR status pills: ⏳ pending / 🔄 running / ❌ failed / ✅ N signals
- Auto-polls every 5 seconds if any league has `lbr_status = 'running'` or `'pending'`

Country-level emojis are hardcoded for common countries; falls back to 🌍.

---

## Data Flow

### Adding a League (full flow)

```
User types "Premier League" + "England"
  → POST /api/leagues
  → DB INSERT (lbr_status = 'pending')
  → Response returned immediately
  → setImmediate background:
      discoverCompetitionId():
        GET {SCRAPER_URL}/discover?name=Premier+League&country=England
        → UPDATE leagues SET competition_id = 1
      runLBRForLeague():
        claude-haiku web search (4-7 queries)
        → UPSERT into signals (btts + draw, factors + stats)
        → UPDATE leagues SET lbr_status='done', signal_count=N, search_query='...'
  → LeaguesPanel polls every 5s and updates UI
```

### Getting Recommendations (full flow)

```
User clicks "Get Recommendations" in Recommendation tab
  → POST /api/search { date: "2026-05-28", leagues: [...], timezone: 4 }
      For each league:
        1. Check search_cache → if hit, use cached matches
        2. If not cached AND league has competition_id:
           GET {SCRAPER_URL}/fixtures?date=2026-05-28&competition_ids=1&upcoming_only=true
           If matches found → cache as 'scraper', use them
           If 0 matches → queue for Claude AI fallback
        3. If no competition_id:
           GET {SCRAPER_URL}/discover → try to find competition_id on-the-fly
           If found → save to DB, use scraper
           If not → queue for Claude AI fallback
        4. Claude AI fallback (if any leagues queued):
           claude-haiku web search with LBR-verified hint queries
           → cache as 'web_search'
      → { matches: [...] }
  → POST /api/recommend/btts { matches: [...] }
      Load signals from DB
      Load last 5 BTTS losses from history
      claude-sonnet selects top 3 picks
      → { recommendations: [...] }
  → UI shows results in TOP 3 tab
```

---

## Known Bugs & Issues

### 🔴 Critical

**1. `POST /api/analyze/draw` calls wrong function**
- File: `server/index.js` line ~556
- `analyzeDraw` route calls `analyzeBTTS(match, league, date, signals)` instead of a dedicated draw analysis function
- Result: Draw analysis returns BTTS-style verdicts (`YES`/`NO`/`SKIP-B`) and uses BTTS signals, not Draw signals
- Fix needed: Create `analyzeDraw()` in `server/ai/draw.js` and call it here

---

### 🟡 Significant

**2. History "Check Result" (↻) uses random mock scores**
- File: `client/src/components/History.jsx` — `checkResult()` function
- The "↻" button and "Check All" generate a random score from a hardcoded 10-item array and derive win/lose from that random score
- This is placeholder logic — there is no real score verification against 365scores or any external source
- Fix needed: Implement real result checking via scraper `/fixtures` with `statusGroup == 4` (finished) and match the game by team names or game ID

**3. `DataConfig` Patterns tab is static / non-functional**
- File: `client/src/components/DataConfig.jsx`
- The Patterns sub-tab shows hardcoded `PATTERNS_BTTS` array (4 items, not from DB)
- Draw patterns tab always shows "Draw patterns accumulate as you use the system" empty state
- These patterns are not saved, not editable, and not used in any AI predictions

**4. `search_cache` has no TTL / expiry**
- File: `server/index.js`
- Cache entries are never deleted or expired
- If fixtures change (rescheduled, postponed), the cache will return stale data forever
- Fix needed: Add `WHERE created_at > NOW() - INTERVAL '12 hours'` to cache lookup queries

---

### 🟢 Minor / Cosmetic

**5. `.rec-date-chip` CSS class is orphaned**
- File: `client/src/App.css` lines 843–851
- The `rec-date-chip` div was removed from `Recommendation.jsx` but its CSS rule remains
- No functional impact; safe to delete the CSS block

**6. Draw tab has no Analysis section**
- `DrawTab.jsx` only has Recommendation / History / Data Config
- Users cannot manually analyze a single draw match
- By design or oversight — no Analysis component exists for draws

**7. LBR polls in LeaguesPanel on every 5s interval even when panel is closed**
- File: `client/src/components/LeaguesPanel.jsx`
- The `setInterval` fires every 5s regardless of whether the panel is visible
- The guard `needsPoll` check prevents unnecessary API calls when all statuses are final
- Low impact: only fires when `lbr_status = 'running'` or `'pending'`

**8. History "edit" form is tightly coupled to row layout**
- The inline edit form replaces other controls in the row (score input, Win/Lose/Cancel buttons)
- No keyboard shortcut to confirm; Enter key is not bound
- Score field has `maxLength={7}` which may be insufficient for extra-time scores like `120-3`

**9. `app.listen` starts before DB is ready**
- File: `server/index.js` (intentional design decision)
- Server starts listening immediately; `initDB()` runs inside the listen callback
- Routes that query the DB (`/api/leagues`, `/api/signals`, etc.) will return 500 errors during the brief window before `initDB()` completes
- This was done to ensure Railway health checks pass even if DB init is slow
- Low impact in practice: DB init typically completes in < 2 seconds

---

*End of SYSTEM.md*
