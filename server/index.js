const express = require('express');
const cors    = require('cors');
const path    = require('path');
const crypto  = require('crypto');
const { Pool } = require('pg');
require('dotenv').config();

const { searchMatches } = require('./ai/search');
const { runLBR }        = require('./ai/lbr');
const { analyzeBTTS, selectTopBTTS } = require('./ai/btts');
const { analyzeDraw, selectTopDraw } = require('./ai/draw');
const { runAssistant }               = require('./ai/assistant');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Scraper service helper ────────────────────────────────────────────────
const SCRAPER_URL = process.env.SCRAPER_URL || '';   // set on Railway

async function scraperGet(path, params = {}) {
  if (!SCRAPER_URL) return null;
  const url = new URL(path, SCRAPER_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── DB ───────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leagues (
      id           SERIAL PRIMARY KEY,
      country          VARCHAR(100) NOT NULL,
      name             VARCHAR(100) NOT NULL,
      emoji            VARCHAR(10)  DEFAULT '🌍',
      lbr_status       VARCHAR(20)  DEFAULT 'pending',
      signal_count     INTEGER      DEFAULT 0,
      search_query     TEXT         DEFAULT NULL,
      found_via_detail TEXT         DEFAULT NULL,
      competition_id   INTEGER      DEFAULT NULL,
      season_num       INTEGER      DEFAULT NULL,
      created_at       TIMESTAMP    DEFAULT NOW(),
      UNIQUE(country, name)
    );

    CREATE TABLE IF NOT EXISTS signals (
      id         SERIAL  PRIMARY KEY,
      type       VARCHAR(10)  NOT NULL,   -- btts | draw
      category   VARCHAR(20)  NOT NULL,   -- factor | stat
      name       TEXT         NOT NULL,
      level      VARCHAR(20)  NOT NULL DEFAULT 'Dormant',
      note       TEXT                  DEFAULT '',
      leagues    TEXT[]                DEFAULT '{}',
      src        VARCHAR(20)           DEFAULT 'LBR',
      created_at TIMESTAMP             DEFAULT NOW(),
      UNIQUE(type, category, name)
    );

    CREATE TABLE IF NOT EXISTS history (
      id               SERIAL  PRIMARY KEY,
      type             VARCHAR(10)  NOT NULL,
      match_name       VARCHAR(200) NOT NULL,
      league           VARCHAR(200),
      match_date       VARCHAR(20),
      verdict          VARCHAR(20),
      source           VARCHAR(10)  DEFAULT 'REC',
      status           VARCHAR(20)  DEFAULT 'pending',
      score            VARCHAR(10),
      reasoning        TEXT,
      matched_signals  JSONB        DEFAULT '[]',
      confidence       INTEGER,
      created_at       TIMESTAMP    DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS search_cache (
      id          SERIAL PRIMARY KEY,
      search_date VARCHAR(20)  NOT NULL,
      league_key  VARCHAR(200) NOT NULL,
      matches     TEXT         NOT NULL,
      round       VARCHAR(100) DEFAULT '',
      found_via   TEXT         DEFAULT 'web_search',
      created_at  TIMESTAMP    DEFAULT NOW(),
      UNIQUE(search_date, league_key)
    );

    CREATE TABLE IF NOT EXISTS patterns (
      id           SERIAL PRIMARY KEY,
      type         VARCHAR(10)  NOT NULL,            -- btts | draw
      name         TEXT         NOT NULL,
      signals      JSONB        NOT NULL DEFAULT '[]',-- [{name,level,category}]
      rating       VARCHAR(20)  NOT NULL DEFAULT 'Unstable', -- Elite|Stable|Unstable|Broken
      usage_count  INTEGER      NOT NULL DEFAULT 0,
      success_rate NUMERIC(5,2) NOT NULL DEFAULT 0,  -- 0.00–100.00
      notes        TEXT                  DEFAULT '',
      created_at   TIMESTAMP    DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS learning_log (
      id          SERIAL PRIMARY KEY,
      type        VARCHAR(10),
      signal_name VARCHAR(200),
      old_level   VARCHAR(20),
      new_level   VARCHAR(20),
      reason      VARCHAR(20),
      match_name  VARCHAR(200),
      match_date  VARCHAR(20),
      verdict     VARCHAR(20),
      created_at  TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ollama_knowledge (
      id         SERIAL PRIMARY KEY,
      topic      TEXT         NOT NULL,
      content    TEXT         NOT NULL,
      source     VARCHAR(20)  DEFAULT 'claude',
      approved   BOOLEAN      DEFAULT FALSE,
      created_at TIMESTAMP    DEFAULT NOW()
    );
  `);

  // Idempotent column additions for existing deployments
  // Run each statement separately so one failure doesn't block the others
  const colMigrations = [
    `ALTER TABLE leagues ADD COLUMN IF NOT EXISTS emoji        VARCHAR(10)  DEFAULT '🌍'`,
    `ALTER TABLE leagues ADD COLUMN IF NOT EXISTS lbr_status   VARCHAR(20)  DEFAULT 'pending'`,
    `ALTER TABLE leagues ADD COLUMN IF NOT EXISTS signal_count INTEGER      DEFAULT 0`,
    `ALTER TABLE leagues ADD COLUMN IF NOT EXISTS lbr_error    TEXT         DEFAULT NULL`,
    `ALTER TABLE signals ADD COLUMN IF NOT EXISTS note         TEXT         DEFAULT ''`,
    `ALTER TABLE signals ADD COLUMN IF NOT EXISTS leagues      TEXT[]       DEFAULT '{}'`,
    `ALTER TABLE search_cache ADD COLUMN IF NOT EXISTS found_via TEXT DEFAULT 'web_search'`,
    `ALTER TABLE leagues ADD COLUMN IF NOT EXISTS search_query     TEXT    DEFAULT NULL`,
    `ALTER TABLE leagues ADD COLUMN IF NOT EXISTS found_via_detail TEXT    DEFAULT NULL`,
    `ALTER TABLE leagues ADD COLUMN IF NOT EXISTS competition_id   INTEGER DEFAULT NULL`,
    `ALTER TABLE leagues ADD COLUMN IF NOT EXISTS season_num       INTEGER DEFAULT NULL`,
    `ALTER TABLE history ADD COLUMN IF NOT EXISTS matched_signals  JSONB   DEFAULT '[]'`,
    `ALTER TABLE history ADD COLUMN IF NOT EXISTS confidence       INTEGER`,
    `CREATE TABLE IF NOT EXISTS learning_log (id SERIAL PRIMARY KEY, type VARCHAR(10), signal_name VARCHAR(200), old_level VARCHAR(20), new_level VARCHAR(20), reason VARCHAR(20), match_name VARCHAR(200), match_date VARCHAR(20), verdict VARCHAR(20), created_at TIMESTAMP DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ollama_knowledge (id SERIAL PRIMARY KEY, topic TEXT NOT NULL, content TEXT NOT NULL, source VARCHAR(20) DEFAULT 'claude', approved BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW())`,
  ];
  for (const sql of colMigrations) {
    await pool.query(sql);
  }

  // Idempotent constraint additions — DO/EXCEPTION ignores "already exists"
  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE leagues ADD UNIQUE (country, name);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    DO $$
    BEGIN
      ALTER TABLE signals ADD UNIQUE (type, category, name);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  console.log('✅ DB ready');
}

// ─── DB-ready gate ────────────────────────────────────────────────────────
let dbReady = false;

function requireDB(req, res, next) {
  if (dbReady) return next();
  res.status(503).json({ error: 'Server is starting up — please try again in a moment' });
}

// ─── Middleware ───────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Auth (no DB required) ───────────────────────────────────────────────
function makeAuthToken(pwd) {
  return crypto.createHash('sha256').update(pwd + '-football-ai-v1').digest('hex');
}

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const pwd = process.env.APP_PASSWORD;
  if (!pwd) return res.json({ ok: true, token: 'open' });        // no password set → open
  const { password } = req.body || {};
  if (!password || password !== pwd) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  res.json({ ok: true, token: makeAuthToken(pwd) });
});

// GET /api/auth/check
app.get('/api/auth/check', (req, res) => {
  const pwd = process.env.APP_PASSWORD;
  if (!pwd) return res.json({ ok: true });                       // no password set → open
  const token = req.headers['x-auth-token'];
  if (token && token === makeAuthToken(pwd)) return res.json({ ok: true });
  res.status(401).json({ error: 'Unauthorized' });
});

app.use('/api', requireDB);

// ─── Health ───────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({
  status: 'OK',
  v: 14,
  anthropic_key: process.env.ANTHROPIC_API_KEY ? 'SET' : 'MISSING',
  scraper_url:   SCRAPER_URL ? 'SET' : 'MISSING',
}));

// ═══════════════════════════════════════════════════════════════════════════
//  LEAGUES
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/leagues
app.get('/api/leagues', async (_, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM leagues ORDER BY country, name');
    res.json({ leagues: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leagues  — adds league, triggers LBR in background
app.post('/api/leagues', async (req, res) => {
  const { country, name, emoji } = req.body;
  if (!country || !name) return res.status(400).json({ error: 'country and name required' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO leagues (country, name, emoji, lbr_status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (country, name) DO UPDATE
         SET lbr_status = 'pending', emoji = EXCLUDED.emoji
       RETURNING *`,
      [country, name, emoji || '🌍']
    );
    const league = rows[0];
    res.json({ success: true, league });

    // ── Background: discover competition_id + run LBR ───────────────────
    setImmediate(async () => {
      await discoverCompetitionId(league);
      runLBRForLeague(league);
    });
  } catch (err) {
    console.error('POST /api/leagues error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/leagues/:id
app.delete('/api/leagues/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM leagues WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Discover competition_id from scraper service ─────────────────────────
async function discoverCompetitionId(league) {
  if (!SCRAPER_URL) return;
  try {
    const data = await scraperGet('/discover', { name: league.name, country: league.country });
    const comps = data?.competitions || [];
    if (comps.length === 0) {
      console.log(`⚠ No competition_id found for ${league.name}`);
      return;
    }
    const best = comps[0];
    await pool.query(
      'UPDATE leagues SET competition_id=$1, season_num=$2 WHERE id=$3',
      [best.id, best.season_num || null, league.id]
    );
    console.log(`🔗 competition_id=${best.id} saved for ${league.name} (${best.country})`);
  } catch (err) {
    console.warn(`⚠ discoverCompetitionId failed for ${league.name}:`, err.message);
  }
}

// ─── Background LBR runner ────────────────────────────────────────────────
async function runLBRForLeague(league) {
  console.log(`▶ LBR starting for ${league.name} (${league.country})`);
  // Readable label stored in signals.leagues[]
  const leagueLabel = `${league.country} — ${league.name}`;
  try {
    await pool.query("UPDATE leagues SET lbr_status='running' WHERE id=$1", [league.id]);

    const data = await runLBR(league.country, league.name);
    if (!data) throw new Error('LBR returned null');

    // ── Extract discovery metadata ──────────────────────────────────────────
    // fixture_query: LBR's recommended search phrase for finding fixtures
    // _queries:      every web_search query LBR actually used (proof it's searchable)
    const fixtureQuery    = (data.fixture_query || '').trim();
    const queriesUsed     = Array.isArray(data._queries) ? data._queries : [];
    const foundViaDetail  = queriesUsed.slice(0, 5).join(' | ');
    // Best search hint: prefer LBR's explicit recommendation, fall back to first query used
    const bestSearchQuery = fixtureQuery || queriesUsed[0] || '';
    console.log(`🔍 LBR discovery — fixture_query: "${fixtureQuery}" | queries used: ${queriesUsed.length}`);

    let count = 0;

    // Helper: upsert one signal, keeping the best quality level seen across leagues
    async function upsertSignal(type, category, signal) {
      const { name, level, note } = signal;
      await pool.query(
        `INSERT INTO signals (type, category, name, level, note, src, leagues)
         VALUES ($1, $2, $3, $4, $5, 'LBR', ARRAY[$6]::TEXT[])
         ON CONFLICT (type, category, name) DO UPDATE
           SET level = CASE
                 WHEN ARRAY_POSITION(ARRAY['Ideal','Good','Weak','Dormant'], signals.level) <=
                      ARRAY_POSITION(ARRAY['Ideal','Good','Weak','Dormant'], EXCLUDED.level)
                 THEN signals.level
                 ELSE EXCLUDED.level
               END,
               note    = EXCLUDED.note,
               leagues = CASE
                 WHEN $6 = ANY(signals.leagues) THEN signals.leagues
                 ELSE array_append(signals.leagues, $6)
               END`,
        [type, category, name, level, note || '', leagueLabel]
      );
      count++;
    }

    for (const f of (data.btts?.factors || [])) await upsertSignal('btts', 'factor', f);
    for (const s of (data.btts?.stats   || [])) await upsertSignal('btts', 'stat',   s);
    // Draw system paused — skip Draw signal generation from LBR
    // for (const f of (data.draw?.factors || [])) await upsertSignal('draw', 'factor', f);
    // for (const s of (data.draw?.stats   || [])) await upsertSignal('draw', 'stat',   s);

    // Count how many signals now reference this league
    const { rows: sc } = await pool.query(
      `SELECT COUNT(*) AS c FROM signals WHERE $1 = ANY(leagues)`,
      [leagueLabel]
    );

    await pool.query(
      `UPDATE leagues
       SET lbr_status='done', signal_count=$1,
           search_query=$2, found_via_detail=$3
       WHERE id=$4`,
      [parseInt(sc[0].c, 10), bestSearchQuery, foundViaDetail, league.id]
    );
    console.log(`✅ LBR done for ${league.name} — ${count} signals upserted | search_query saved: "${bestSearchQuery}"`);
  } catch (err) {
    console.error(`❌ LBR failed for ${league.name}:`, err.message);
    await pool.query(
      "UPDATE leagues SET lbr_status='failed', lbr_error=$2 WHERE id=$1",
      [league.id, String(err.message || err).slice(0, 500)]
    ).catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SIGNALS
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/signals?type=btts|draw
app.get('/api/signals', async (req, res) => {
  const { type } = req.query;
  if (!type) return res.status(400).json({ error: 'type query param required' });
  try {
    const { rows } = await pool.query(
      `SELECT * FROM signals WHERE type = $1
       ORDER BY category,
         CASE level WHEN 'Ideal' THEN 1 WHEN 'Good' THEN 2 WHEN 'Weak' THEN 3 ELSE 4 END,
         name`,
      [type]
    );
    const factors = rows.filter(r => r.category === 'factor');
    const stats   = rows.filter(r => r.category === 'stat');
    res.json({ factors, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/signals  — manual add
app.post('/api/signals', async (req, res) => {
  const { type, category, name, level } = req.body;
  if (!type || !category || !name) return res.status(400).json({ error: 'type, category, name required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO signals (type, category, name, level, src)
       VALUES ($1, $2, $3, $4, 'Manual')
       ON CONFLICT (type, category, name) DO UPDATE SET level = $4
       RETURNING *`,
      [type, category, name, level || 'Dormant']
    );
    res.json({ success: true, signal: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/signals/:id
app.delete('/api/signals/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM signals WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  AI — SEARCH
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/search  body: { date, leagues: [{country, name}], timezone?: number }
app.post('/api/search', async (req, res) => {
  const { date, leagues, timezone } = req.body;
  if (!date || !leagues?.length) return res.status(400).json({ error: 'date and leagues required' });

  try {
    const allMatches      = [];
    const uncachedLeagues = [];

    // ── Per-league cache check ─────────────────────────────────────────────
    for (const league of leagues) {
      const leagueKey = `${league.country}:${league.name}`;
      const { rows } = await pool.query(
        `SELECT matches FROM search_cache
         WHERE search_date=$1 AND league_key=$2
           AND created_at > NOW() - INTERVAL '12 hours'`,
        [date, leagueKey]
      );
      if (rows.length > 0) {
        const cached = JSON.parse(rows[0].matches);
        allMatches.push(...cached);
        console.log(`📦 Cache hit: ${leagueKey} (${cached.length} matches)`);
      } else {
        uncachedLeagues.push(league);
      }
    }

    // ── Scraper-first for uncached leagues ─────────────────────────────────
    if (uncachedLeagues.length > 0 && SCRAPER_URL) {
      // Load competition_ids from DB
      const { rows: dbLeagues } = await pool.query(
        `SELECT name, country, competition_id, season_num, search_query
         FROM leagues WHERE name = ANY($1::text[])`,
        [uncachedLeagues.map(l => l.name)]
      ).catch(() => ({ rows: [] }));

      const scraperLeagues  = [];
      const aiLeagues       = [];

      for (const league of uncachedLeagues) {
        const dbRow = dbLeagues.find(r => r.name === league.name && r.country === league.country);
        if (dbRow?.competition_id) {
          scraperLeagues.push({ ...league, competition_id: dbRow.competition_id });
        } else {
          // Try to discover competition_id on-the-fly
          const disc = await scraperGet('/discover', { name: league.name, country: league.country });
          const comps = disc?.competitions || [];
          if (comps.length > 0) {
            const best = comps[0];
            // Save for future
            await pool.query(
              `UPDATE leagues SET competition_id=$1, season_num=$2 WHERE country=$3 AND name=$4`,
              [best.id, best.season_num || null, league.country, league.name]
            ).catch(() => {});
            console.log(`🔗 On-the-fly discovery: ${league.name} → competition_id=${best.id}`);
            scraperLeagues.push({ ...league, competition_id: best.id });
          } else {
            aiLeagues.push(league);
          }
        }
      }

      // ── Scraper fetch (PRIMARY source) ──────────────────────────────────
      if (scraperLeagues.length > 0) {
        const compIds = scraperLeagues.map(l => l.competition_id).join(',');
        console.log(`⚽ Scraper: date=${date} competition_ids=${compIds} upcoming_only=true`);
        const scraperData    = await scraperGet('/fixtures', {
          date,
          competition_ids: compIds,
          upcoming_only:   'true',          // Rule 3: only not-started matches
        });
        const scraperMatches = scraperData?.matches || [];
        console.log(`⚽ Scraper: ${scraperMatches.length} upcoming match(es) for requested leagues`);

        let scraperTotal = 0;
        for (const league of scraperLeagues) {
          const leagueKey     = `${league.country}:${league.name}`;
          const leagueMatches = scraperMatches.filter(m => m.competition_id === league.competition_id);

          if (leagueMatches.length > 0) {
            // ✅ Scraper has data — use it, skip Claude for this league
            allMatches.push(...leagueMatches);
            scraperTotal += leagueMatches.length;
            await cacheSearchResult(date, leagueKey, leagueMatches, 'scraper');
            console.log(`📦 Scraper: ${leagueKey} → ${leagueMatches.length} matches`);
          } else {
            // ⚠ Scraper returned nothing for this league → queue Claude AI fallback
            console.log(`⚠ Scraper: 0 matches for ${leagueKey} → queuing 🔍 Claude web search fallback`);
            aiLeagues.push(league);
          }
        }
        console.log(`📦 Scraper: ${scraperTotal} match(es) found | 🔍 AI fallback queue: ${aiLeagues.length} league(s)`);
      }

      // ── Claude AI fallback (scraper had no data or league has no competition_id) ────
      if (aiLeagues.length > 0) {
        console.log(`🔍 Claude web search fallback for ${aiLeagues.length} league(s): ${aiLeagues.map(l => l.name).join(', ')}`);

        const { rows: hintRows } = await pool.query(
          `SELECT name, country, search_query FROM leagues
           WHERE name = ANY($1::text[]) AND search_query IS NOT NULL AND search_query <> ''`,
          [aiLeagues.map(l => l.name)]
        ).catch(() => ({ rows: [] }));

        const aiLeaguesWithHints = aiLeagues.map(l => {
          const hint = hintRows.find(r => r.name === l.name && r.country === l.country);
          if (hint?.search_query) return { ...l, search_query: hint.search_query };
          return l;
        });

        const newMatches = await searchMatches(date, aiLeaguesWithHints, timezone ?? 0);
        allMatches.push(...newMatches);

        // Cache AI results per league
        for (const league of aiLeagues) {
          const leagueKey     = `${league.country}:${league.name}`;
          const leagueMatches = newMatches.filter(m => {
            const mL = (m.league || '').toLowerCase();
            const qL = league.name.toLowerCase();
            return mL.includes(qL) || qL.includes(mL);
          });
          await cacheSearchResult(date, leagueKey, leagueMatches, 'web_search');
          if (leagueMatches.length > 0) console.log(`💾 Cached (AI): ${leagueKey} (${leagueMatches.length} matches)`);
        }
      }

    } else if (uncachedLeagues.length > 0) {
      // ── No SCRAPER_URL configured — pure Claude AI path ─────────────────
      console.log(`🔍 Claude web search (no scraper configured) for ${uncachedLeagues.length} league(s)`);
      const { rows: hintRows } = await pool.query(
        `SELECT name, country, search_query FROM leagues
         WHERE name = ANY($1::text[]) AND search_query IS NOT NULL AND search_query <> ''`,
        [uncachedLeagues.map(l => l.name)]
      ).catch(() => ({ rows: [] }));

      const withHints  = uncachedLeagues.map(l => {
        const hint = hintRows.find(r => r.name === l.name && r.country === l.country);
        return hint?.search_query ? { ...l, search_query: hint.search_query } : l;
      });
      const newMatches = await searchMatches(date, withHints, timezone ?? 0);
      allMatches.push(...newMatches);

      for (const league of uncachedLeagues) {
        const leagueKey     = `${league.country}:${league.name}`;
        const leagueMatches = newMatches.filter(m => {
          const mL = (m.league || '').toLowerCase();
          const qL = league.name.toLowerCase();
          return mL.includes(qL) || qL.includes(mL);
        });
        await cacheSearchResult(date, leagueKey, leagueMatches, 'web_search');
      }
    }

    res.json({ matches: allMatches });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  AI — ANALYSIS (single match)
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/analyze/btts  body: { match, league, date, liveMinute?, liveScore? }
app.post('/api/analyze/btts', async (req, res) => {
  const { match, league, date, liveMinute, liveScore } = req.body;
  if (!match) return res.status(400).json({ error: 'match required' });
  try {
    const signals  = await getSignals('btts');
    const liveCtx  = (liveMinute != null || liveScore) ? { minute: liveMinute, score: liveScore } : null;
    const result   = await analyzeBTTS(match, league || '', date || '', signals, liveCtx);
    res.json(result);
  } catch (err) {
    console.error('BTTS analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/analyze/draw  body: { match, league, date }
app.post('/api/analyze/draw', async (req, res) => {
  const { match, league, date } = req.body;
  if (!match) return res.status(400).json({ error: 'match required' });
  try {
    const signals = await getSignals('draw');
    const result  = await analyzeDraw(match, league || '', date || '', signals);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  AI — RECOMMENDATIONS (multi-match selection)
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/recommend/btts  body: { matches: [{match, league, date}] }
app.post('/api/recommend/btts', async (req, res) => {
  const { matches } = req.body;
  if (!matches?.length) return res.status(400).json({ error: 'matches required' });
  try {
    const signals = await getSignals('btts');
    // Fetch recent BTTS losses — included in Council context to learn from mistakes
    const { rows: recentLosses } = await pool.query(
      `SELECT match_name, reasoning FROM history
       WHERE type = 'btts' AND status = 'lose'
       ORDER BY created_at DESC LIMIT 5`
    );
    const top = await selectTopBTTS(matches, signals, recentLosses);
    res.json({ recommendations: top });
  } catch (err) {
    console.error('BTTS recommend error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/recommend/draw  body: { matches: [{match, league, date}] }
app.post('/api/recommend/draw', async (req, res) => {
  const { matches } = req.body;
  if (!matches?.length) return res.status(400).json({ error: 'matches required' });
  try {
    const signals = await getSignals('draw');
    // Fetch recent Draw losses — included in Council context to learn from mistakes
    const { rows: recentLosses } = await pool.query(
      `SELECT match_name, reasoning FROM history
       WHERE type = 'draw' AND status = 'lose'
       ORDER BY created_at DESC LIMIT 5`
    );
    const top = await selectTopDraw(matches, signals, recentLosses);
    res.json({ recommendations: top });
  } catch (err) {
    console.error('Draw recommend error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  HISTORY
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/history?type=btts|draw
app.get('/api/history', async (req, res) => {
  const { type } = req.query;
  try {
    const q = type
      ? 'SELECT * FROM history WHERE type=$1 ORDER BY created_at DESC LIMIT 100'
      : 'SELECT * FROM history ORDER BY created_at DESC LIMIT 100';
    const params = type ? [type] : [];
    const { rows } = await pool.query(q, params);
    res.json({ history: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/history
app.post('/api/history', async (req, res) => {
  const { type, match_name, league, match_date, verdict, source, reasoning, matched_signals, confidence } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO history (type, match_name, league, match_date, verdict, source, reasoning, matched_signals, confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [type, match_name, league, match_date, verdict, source || 'REC', reasoning || '',
       JSON.stringify(matched_signals || []), confidence ?? null]
    );
    res.json({ success: true, item: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/history/:id  — update score/status after match played
app.patch('/api/history/:id', async (req, res) => {
  const { score, status } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE history SET score=$1, status=$2 WHERE id=$3 RETURNING *',
      [score, status, req.params.id]
    );
    res.json({ success: true, item: rows[0] });
    if (status === 'win' || status === 'lose') {
      runLearning(req.params.id);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/history/:id/check  — fetch real score from scraper and update
app.post('/api/history/:id/check', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM history WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'History entry not found' });
    const entry = rows[0];

    if (!SCRAPER_URL) return res.status(422).json({ error: 'Scraper not configured' });
    if (!entry.match_date) return res.status(422).json({ error: 'No match date on record' });

    // Convert DD.MM.YYYY → YYYY-MM-DD
    const dateParts = entry.match_date.split('.');
    const isoDate   = dateParts.length === 3
      ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`
      : entry.match_date;

    // Find the league's competition_id
    const { rows: lgRows } = await pool.query(
      'SELECT competition_id FROM leagues WHERE name=$1 LIMIT 1',
      [entry.league]
    ).catch(() => ({ rows: [] }));

    const competitionId = lgRows[0]?.competition_id;
    if (!competitionId) return res.status(422).json({ error: 'No competition_id for this league' });

    const data    = await scraperGet('/fixtures', { date: isoDate, competition_ids: String(competitionId) });
    const matches = data?.matches || [];

    // Match by name (teams in either order)
    const nameParts = (entry.match_name || '').split(' vs ');
    const home      = (nameParts[0] || '').toLowerCase().trim();
    const away      = (nameParts[1] || '').toLowerCase().trim();
    const found     = matches.find(m => {
      const mn = (m.match || '').toLowerCase();
      return (home && mn.includes(home)) || (away && mn.includes(away));
    });

    if (!found || !found.score) {
      return res.status(422).json({ error: 'Score not yet available — match may not have been played' });
    }

    const score   = found.score;
    const [h, a]  = score.split('-').map(Number);
    const win     = (!isNaN(h) && !isNaN(a))
      ? (entry.type === 'btts' ? (h > 0 && a > 0) : (h === a))
      : null;
    const status  = win === true ? 'win' : win === false ? 'lose' : 'pending';

    await pool.query('UPDATE history SET score=$1, status=$2 WHERE id=$3', [score, status, entry.id]);
    res.json({ success: true, score, status });
    if (status === 'win' || status === 'lose') {
      runLearning(req.params.id);
    }
  } catch (err) {
    console.error('History check error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/history/:id
app.delete('/api/history/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM history WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/patterns?type=btts|draw
app.get('/api/patterns', async (req, res) => {
  const { type } = req.query;
  if (!type) return res.status(400).json({ error: 'type query param required' });
  try {
    const { rows } = await pool.query(
      `SELECT * FROM patterns WHERE type=$1
       ORDER BY
         CASE rating WHEN 'Elite' THEN 1 WHEN 'Stable' THEN 2 WHEN 'Unstable' THEN 3 ELSE 4 END,
         name`,
      [type]
    );
    res.json({ patterns: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/patterns  body: { type, name, signals, rating, notes }
app.post('/api/patterns', async (req, res) => {
  const { type, name, signals, rating, notes } = req.body;
  if (!type || !name) return res.status(400).json({ error: 'type and name required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO patterns (type, name, signals, rating, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [type, name, JSON.stringify(signals || []), rating || 'Unstable', notes || '']
    );
    res.json({ success: true, pattern: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/patterns/:id  — update any combination of fields
app.patch('/api/patterns/:id', async (req, res) => {
  const allowed = ['name', 'signals', 'rating', 'usage_count', 'success_rate', 'notes'];
  const sets = [], vals = [];
  let i = 1;
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      sets.push(`${key}=$${i++}`);
      vals.push(key === 'signals' ? JSON.stringify(req.body[key]) : req.body[key]);
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
  vals.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE patterns SET ${sets.join(', ')} WHERE id=$${i} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Pattern not found' });
    res.json({ success: true, pattern: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/patterns/:id
app.delete('/api/patterns/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM patterns WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Signal learning helpers ──────────────────────────────────────────────
const LEVELS = ['Dormant', 'Weak', 'Good', 'Ideal'];

function levelUp(level) {
  const i = LEVELS.indexOf(level);
  return i === -1 ? level : LEVELS[Math.min(i + 1, LEVELS.length - 1)];
}

function levelDown(level) {
  const i = LEVELS.indexOf(level);
  return i === -1 ? level : LEVELS[Math.max(i - 1, 0)];
}

async function runLearning(historyId) {
  try {
    const { rows } = await pool.query('SELECT * FROM history WHERE id=$1', [historyId]);
    if (!rows.length) return;
    const entry = rows[0];

    const { status, type, match_name, match_date, verdict, matched_signals } = entry;
    if (status !== 'win' && status !== 'lose') return;

    const signals = Array.isArray(matched_signals) ? matched_signals : [];
    if (!signals.length) {
      console.log(`⚠ Learning skipped for "${match_name}" — no matched_signals saved`);
      return;
    }

    const isWin = status === 'win';

    for (const sig of signals) {
      if (!sig.name) continue;

      // Look up current level in DB (match by type + name, any category)
      const { rows: sigRows } = await pool.query(
        'SELECT id, level FROM signals WHERE type=$1 AND name=$2 LIMIT 1',
        [type, sig.name]
      );
      if (!sigRows.length) {
        console.log(`⚠ Learning: signal "${sig.name}" not found in DB — skipping`);
        continue;
      }

      const { id: sigId, level: oldLevel } = sigRows[0];
      const newLevel = isWin ? levelUp(oldLevel) : levelDown(oldLevel);

      if (newLevel === oldLevel) {
        console.log(`— Signal "${sig.name}" already at ${oldLevel} — no change`);
        continue;
      }

      await pool.query('UPDATE signals SET level=$1 WHERE id=$2', [newLevel, sigId]);

      await pool.query(
        `INSERT INTO learning_log (type, signal_name, old_level, new_level, reason, match_name, match_date, verdict)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [type, sig.name, oldLevel, newLevel, isWin ? 'win' : 'lose', match_name, match_date, verdict]
      );

      const arrow  = isWin ? '📈' : '📉';
      const action = isWin ? 'strengthened' : 'weakened';
      console.log(`${arrow} Signal ${action}: "${sig.name}" ${oldLevel}→${newLevel} (${match_name})`);
    }
  } catch (err) {
    console.error('runLearning error:', err.message);
  }
}

// ─── Helper: cache one league's search results ────────────────────────────
async function cacheSearchResult(date, leagueKey, matches, foundVia) {
  if (!matches.length) return;
  const round = matches[0]?.round || '';
  await pool.query(
    `INSERT INTO search_cache (search_date, league_key, matches, round, found_via)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (search_date, league_key) DO UPDATE
       SET matches=$3, round=$4, found_via=$5, created_at=NOW()`,
    [date, leagueKey, JSON.stringify(matches), round, foundVia]
  ).catch(() => {});
}

// ─── Helper: load signals from DB ─────────────────────────────────────────
async function getSignals(type) {
  const { rows } = await pool.query(
    `SELECT * FROM signals WHERE type=$1
     ORDER BY CASE level WHEN 'Ideal' THEN 1 WHEN 'Good' THEN 2 WHEN 'Weak' THEN 3 ELSE 4 END, name`,
    [type]
  );
  return {
    factors: rows.filter(r => r.category === 'factor'),
    stats:   rows.filter(r => r.category === 'stat')
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  OLLAMA KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/ollama/knowledge?q=optional_search_text
app.get('/api/ollama/knowledge', async (req, res) => {
  const { q } = req.query;
  try {
    const { rows } = q
      ? await pool.query(
          `SELECT * FROM ollama_knowledge
           WHERE topic ILIKE $1 OR content ILIKE $1
           ORDER BY approved DESC, created_at DESC LIMIT 20`,
          [`%${q}%`]
        )
      : await pool.query(
          `SELECT * FROM ollama_knowledge ORDER BY approved DESC, created_at DESC LIMIT 50`
        );
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ollama/knowledge  body: { topic, content, source }
app.post('/api/ollama/knowledge', async (req, res) => {
  const { topic, content, source } = req.body;
  if (!topic || !content) return res.status(400).json({ error: 'topic and content required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO ollama_knowledge (topic, content, source)
       VALUES ($1,$2,$3) RETURNING *`,
      [topic, content, source || 'claude']
    );
    res.json({ success: true, item: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/ollama/knowledge/:id  body: { approved }
app.patch('/api/ollama/knowledge/:id', async (req, res) => {
  const { approved } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE ollama_knowledge SET approved=$1 WHERE id=$2 RETURNING *`,
      [approved, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, item: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/ollama/knowledge/:id
app.delete('/api/ollama/knowledge/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM ollama_knowledge WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  AI ASSISTANT  (Claude — LBR mode or Analysis mode)
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/assistant  body: { messages: [{role,content}], context?, mode? }
app.post('/api/assistant', async (req, res) => {
  const { messages, context, mode } = req.body;
  if (!messages?.length) return res.status(400).json({ error: 'messages required' });
  try {
    const signals = await getSignals('btts')
      .then(b => b.factors.concat(b.stats).map(s => ({ ...s, type: 'btts' })))
      .catch(() => []);
    const drawSigs = await getSignals('draw')
      .then(d => d.factors.concat(d.stats).map(s => ({ ...s, type: 'draw' })))
      .catch(() => []);

    const reply = await runAssistant(messages, {
      context: context || '',
      signals: [...signals, ...drawSigs],
      mode:    mode || 'analysis',
    });
    res.json({ reply });
  } catch (err) {
    console.error('Assistant error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  STATIC CLIENT BUILD  (must be LAST, after all /api routes)
// ═══════════════════════════════════════════════════════════════════════════
const CLIENT_DIST = path.join(__dirname, '../client/dist');
const INDEX_HTML  = path.join(CLIENT_DIST, 'index.html');

app.use(express.static(CLIENT_DIST));

// SPA fallback — app.use() works in both Express 4 and 5 (app.get('*') is invalid in Express 5)
app.use((req, res) => {
  const fs = require('fs');
  if (fs.existsSync(INDEX_HTML)) {
    res.sendFile(INDEX_HTML);
  } else {
    res.status(503).send(
      '<h2>App is starting…</h2>' +
      '<p>Client build not found. Railway build may still be in progress.</p>' +
      '<p>Try refreshing in a few seconds.</p>'
    );
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────
// Start listening FIRST so Railway's HTTP health check (/health) passes
// immediately. DB init runs in the background — if it fails, routes that
// need the DB will return 500s, but the server itself stays up.
console.log(`🚀 Starting server on port ${PORT}…`);
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
  initDB()
    .then(() => { dbReady = true; console.log('✅ DB ready'); })
    .catch(err => {
      console.error('❌ DB init failed:', err.message);
      // Don't exit — keep the server up so health check keeps passing.
      // Routes that need the DB will return 500s until a restart fixes it.
    });
});
