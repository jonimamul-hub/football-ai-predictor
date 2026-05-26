const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const { searchMatches } = require('./ai/search');
const { runLBR }        = require('./ai/lbr');
const { analyzeBTTS, selectTopBTTS } = require('./ai/btts');
const { selectTopDraw } = require('./ai/draw');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── DB ───────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leagues (
      id         SERIAL PRIMARY KEY,
      country    VARCHAR(100) NOT NULL,
      name       VARCHAR(100) NOT NULL,
      emoji      VARCHAR(10)  DEFAULT '🌍',
      lbr_status VARCHAR(20)  DEFAULT 'pending',
      created_at TIMESTAMP    DEFAULT NOW(),
      UNIQUE(country, name)
    );

    CREATE TABLE IF NOT EXISTS signals (
      id         SERIAL  PRIMARY KEY,
      type       VARCHAR(10)  NOT NULL,   -- btts | draw
      category   VARCHAR(20)  NOT NULL,   -- factor | stat
      name       TEXT         NOT NULL,
      level      VARCHAR(20)  NOT NULL DEFAULT 'Dormant',
      src        VARCHAR(20)           DEFAULT 'LBR',
      created_at TIMESTAMP             DEFAULT NOW(),
      UNIQUE(type, category, name)
    );

    CREATE TABLE IF NOT EXISTS history (
      id          SERIAL  PRIMARY KEY,
      type        VARCHAR(10)  NOT NULL,
      match_name  VARCHAR(200) NOT NULL,
      league      VARCHAR(200),
      match_date  VARCHAR(20),
      verdict     VARCHAR(20),
      source      VARCHAR(10)  DEFAULT 'REC',
      status      VARCHAR(20)  DEFAULT 'pending',
      score       VARCHAR(10),
      reasoning   TEXT,
      created_at  TIMESTAMP    DEFAULT NOW()
    );
  `);
  console.log('✅ DB ready');
}

// ─── Middleware ───────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Health ───────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'OK' }));

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
       ON CONFLICT (country, name) DO UPDATE SET lbr_status = 'pending'
       RETURNING *`,
      [country, name, emoji || '🌍']
    );
    const league = rows[0];
    res.json({ success: true, league });

    // ── LBR fires AFTER response is sent ────────────────────────────────
    setImmediate(() => runLBRForLeague(league));
  } catch (err) {
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

// ─── Background LBR runner ────────────────────────────────────────────────
async function runLBRForLeague(league) {
  console.log(`▶ LBR starting for ${league.name} (${league.country})`);
  try {
    await pool.query("UPDATE leagues SET lbr_status='running' WHERE id=$1", [league.id]);

    const data = await runLBR(league.country, league.name);
    if (!data) throw new Error('LBR returned null');

    let count = 0;

    // Upsert BTTS signals
    for (const f of (data.btts?.factors || [])) {
      await pool.query(
        `INSERT INTO signals (type, category, name, level, src)
         VALUES ('btts', 'factor', $1, $2, 'LBR')
         ON CONFLICT (type, category, name) DO UPDATE SET level = $2`,
        [f.name, f.level]
      );
      count++;
    }
    for (const s of (data.btts?.stats || [])) {
      await pool.query(
        `INSERT INTO signals (type, category, name, level, src)
         VALUES ('btts', 'stat', $1, $2, 'LBR')
         ON CONFLICT (type, category, name) DO UPDATE SET level = $2`,
        [s.name, s.level]
      );
      count++;
    }

    // Upsert Draw signals
    for (const f of (data.draw?.factors || [])) {
      await pool.query(
        `INSERT INTO signals (type, category, name, level, src)
         VALUES ('draw', 'factor', $1, $2, 'LBR')
         ON CONFLICT (type, category, name) DO UPDATE SET level = $2`,
        [f.name, f.level]
      );
      count++;
    }
    for (const s of (data.draw?.stats || [])) {
      await pool.query(
        `INSERT INTO signals (type, category, name, level, src)
         VALUES ('draw', 'stat', $1, $2, 'LBR')
         ON CONFLICT (type, category, name) DO UPDATE SET level = $2`,
        [s.name, s.level]
      );
      count++;
    }

    await pool.query("UPDATE leagues SET lbr_status='done' WHERE id=$1", [league.id]);
    console.log(`✅ LBR done for ${league.name} — ${count} signals upserted`);
  } catch (err) {
    console.error(`❌ LBR failed for ${league.name}:`, err.message);
    await pool.query("UPDATE leagues SET lbr_status='failed' WHERE id=$1", [league.id]).catch(() => {});
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
      "SELECT * FROM signals WHERE type = $1 ORDER BY category, level DESC, name",
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

// POST /api/search  body: { date, leagues: [{country, name}] }
app.post('/api/search', async (req, res) => {
  const { date, leagues } = req.body;
  if (!date || !leagues?.length) return res.status(400).json({ error: 'date and leagues required' });
  try {
    const matches = await searchMatches(date, leagues);
    res.json({ matches });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  AI — ANALYSIS (single match)
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/analyze/btts  body: { match, league, date }
app.post('/api/analyze/btts', async (req, res) => {
  const { match, league, date } = req.body;
  if (!match) return res.status(400).json({ error: 'match required' });
  try {
    const signals  = await getSignals('btts');
    const result   = await analyzeBTTS(match, league || '', date || '', signals);
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
    const result  = await analyzeBTTS(match, league || '', date || '', signals); // reuse same pattern
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
    const top     = await selectTopBTTS(matches, signals);
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
    const top     = await selectTopDraw(matches, signals);
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
  const { type, match_name, league, match_date, verdict, source, reasoning } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO history (type, match_name, league, match_date, verdict, source, reasoning)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [type, match_name, league, match_date, verdict, source || 'REC', reasoning || '']
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Helper: load signals from DB ─────────────────────────────────────────
async function getSignals(type) {
  const { rows } = await pool.query(
    "SELECT * FROM signals WHERE type=$1 ORDER BY level DESC, name",
    [type]
  );
  return {
    factors: rows.filter(r => r.category === 'factor'),
    stats:   rows.filter(r => r.category === 'stat')
  };
}

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

// ─── Debug route (temporary) ──────────────────────────────────────────────
app.get('/debug-fs', (_, res) => {
  const fs = require('fs');
  const checks = [
    __dirname,
    path.join(__dirname, '..'),
    CLIENT_DIST,
    INDEX_HTML,
  ];
  const info = checks.map(p => {
    try {
      const exists = fs.existsSync(p);
      const items  = exists && fs.statSync(p).isDirectory()
        ? fs.readdirSync(p).slice(0, 20)
        : [];
      return { path: p, exists, items };
    } catch(e) { return { path: p, error: e.message }; }
  });
  res.json({ info });
});

// ─── Boot ─────────────────────────────────────────────────────────────────
initDB().then(() => {
  const fs = require('fs');
  console.log(`📁 __dirname: ${__dirname}`);
  console.log(`📁 CLIENT_DIST exists: ${fs.existsSync(CLIENT_DIST)}`);
  console.log(`📁 INDEX_HTML exists: ${fs.existsSync(INDEX_HTML)}`);
  app.listen(PORT, () => console.log(`✅ Server on port ${PORT}`));
}).catch(err => {
  console.error('DB init failed:', err.message);
  process.exit(1);
});
