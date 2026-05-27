"""
Football Data Service — 365scores public API
Provides: fixtures, discover, form, h2h, standings
No authentication required.
"""

import os
import time
from datetime import datetime, timedelta
from flask import Flask, jsonify, request
import requests

app = Flask(__name__)

# ─── 365scores API config ────────────────────────────────────────────────────
BASE = "https://webws.365scores.com/web"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept":          "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer":         "https://www.365scores.com/",
    "Origin":          "https://www.365scores.com",
}
DEFAULT_PARAMS = {"appTypeId": "5", "langId": "1"}

# In-process cache
_cache: dict = {}
CACHE_TTL = 300  # 5 minutes


def _cache_get(key):
    entry = _cache.get(key)
    if entry and (time.time() - entry[0]) < CACHE_TTL:
        return entry[1]
    return None


def _cache_set(key, data):
    _cache[key] = (time.time(), data)


def api_get(path: str, params: dict = None) -> dict:
    p = {**DEFAULT_PARAMS, **(params or {})}
    cache_key = path + "|" + "&".join(f"{k}={v}" for k, v in sorted(p.items()))
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    r = requests.get(f"{BASE}/{path}/", headers=HEADERS, params=p, timeout=20)
    r.raise_for_status()
    data = r.json()
    _cache_set(cache_key, data)
    return data


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _to_api_date(date_str: str) -> str:
    """YYYY-MM-DD → DD/MM/YYYY"""
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").strftime("%d/%m/%Y")
    except Exception:
        return datetime.now().strftime("%d/%m/%Y")


def _fetch_day(api_date: str) -> tuple:
    """(games_list, comps_by_id, countries_by_id)"""
    data  = api_get("games", {"startDate": api_date, "endDate": api_date, "sports": "1"})
    comps = {c["id"]: c for c in data.get("competitions", [])}
    ctrys = {c["id"]: c["name"] for c in data.get("countries", [])}
    return data.get("games", []), comps, ctrys


def _parse_game(g: dict, comps: dict, ctrys: dict) -> dict:
    comp  = comps.get(g.get("competitionId", 0), {})
    cid   = comp.get("countryId", 0)
    home  = g.get("homeCompetitor", {})
    away  = g.get("awayCompetitor", {})

    start = g.get("startTime", "")
    try:
        dt       = datetime.fromisoformat(start.replace("Z", "+00:00"))
        time_str = dt.strftime("%H:%M")
        date_out = dt.strftime("%d.%m.%Y")
    except Exception:
        time_str = ""
        date_out = ""

    h_sc = home.get("score")
    a_sc = away.get("score")
    score = (f"{int(h_sc)}-{int(a_sc)}"
             if h_sc is not None and a_sc is not None else "")

    w = g.get("winner", -1)
    result = {0: "D", 1: "H", 2: "A"}.get(w, "")

    return {
        "match":          f"{home.get('name','')} vs {away.get('name','')}",
        "home_team":      home.get("name", ""),
        "away_team":      away.get("name", ""),
        "home_id":        home.get("id"),
        "away_id":        away.get("id"),
        "league":         comp.get("name", g.get("competitionDisplayName", "")),
        "country":        ctrys.get(cid, ""),
        "date":           date_out,
        "time":           time_str,
        "round":          f"Round {g.get('roundNum', '')}".strip(),
        "round_num":      g.get("roundNum"),
        "score":          score,
        "status":         g.get("statusText", ""),
        "result":         result,
        "game_id":        g.get("id"),
        "competition_id": g.get("competitionId"),
        "season_num":     g.get("seasonNum"),
        "has_stats":      g.get("hasStats", False),
    }


# ═══════════════════════════════════════════════════════════════════════════
#  ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@app.route("/health")
def health():
    return jsonify({"status": "ok", "source": "365scores", "v": 2})


# ── /fixtures ─────────────────────────────────────────────────────────────
@app.route("/fixtures")
def fixtures():
    """
    GET /fixtures?date=YYYY-MM-DD&competition_ids=5455,123
    Returns all matches for that date, filtered by competition IDs if provided.
    """
    date_str   = request.args.get("date", datetime.now().strftime("%Y-%m-%d"))
    comp_ids_s = request.args.get("competition_ids", "")
    comp_ids   = {int(x) for x in comp_ids_s.split(",") if x.strip().lstrip("-").isdigit()}

    try:
        games, comps, ctrys = _fetch_day(_to_api_date(date_str))
    except Exception as e:
        return jsonify({"error": str(e), "matches": []}), 500

    if comp_ids:
        games = [g for g in games if g.get("competitionId") in comp_ids]

    return jsonify({
        "matches": [_parse_game(g, comps, ctrys) for g in games],
        "total":   len(games),
        "date":    date_str,
    })


# ── /discover ─────────────────────────────────────────────────────────────
@app.route("/discover")
def discover():
    """
    GET /discover?name=Premier+League&country=Kazakhstan
    Scans upcoming + recent dates to find competition IDs by name.
    """
    name    = request.args.get("name", "").strip().lower()
    country = request.args.get("country", "").strip().lower()
    if not name:
        return jsonify({"error": "name required", "competitions": []}), 400

    today  = datetime.now()
    deltas = [0, 1, 2, 3, 7, -1, -2, 14, -7]
    seen:  set  = set()
    results     = []

    for delta in deltas:
        api_date = (today + timedelta(days=delta)).strftime("%d/%m/%Y")
        try:
            _, comps, ctrys = _fetch_day(api_date)
        except Exception:
            continue

        for comp in comps.values():
            if comp["id"] in seen:
                continue
            comp_name    = comp.get("name", "").lower()
            comp_country = ctrys.get(comp.get("countryId", 0), "").lower()

            name_words = [w for w in name.split() if len(w) > 2]
            country_ok = (not country) or (country in comp_country) or (comp_country in country)
            name_ok    = (name in comp_name) or any(w in comp_name for w in name_words)

            if name_ok and country_ok:
                seen.add(comp["id"])
                score = (
                    sum(1 for w in name_words if w in comp_name)
                    + (3 if name == comp_name else 2 if name in comp_name else 0)
                    + (1 if country_ok and country else 0)
                )
                results.append({
                    "id":         comp["id"],
                    "name":       comp["name"],
                    "country":    ctrys.get(comp.get("countryId", 0), ""),
                    "season_num": comp.get("currentSeasonNum"),
                    "_score":     score,
                })

        if results:
            break  # found something — stop searching further dates

    results.sort(key=lambda x: -x["_score"])
    for r in results:
        del r["_score"]

    return jsonify({"competitions": results, "query": {"name": name, "country": country}})


# ── /form ─────────────────────────────────────────────────────────────────
@app.route("/form")
def form():
    """
    GET /form?competitor_id=29793&limit=5
    Scans the last ~30 days to find the team's recent completed matches.
    """
    competitor_id = request.args.get("competitor_id", "")
    limit         = min(int(request.args.get("limit", "5")), 10)
    if not competitor_id:
        return jsonify({"error": "competitor_id required"}), 400

    try:
        cid   = int(competitor_id)
        today = datetime.now()
        found = []

        # Scan backwards up to 60 days in 3-day steps
        for delta in range(0, 61, 3):
            if len(found) >= limit:
                break
            api_date = (today - timedelta(days=delta)).strftime("%d/%m/%Y")
            games, comps, ctrys = _fetch_day(api_date)

            for g in games:
                if g.get("statusGroup") != 4:  # only completed
                    continue
                h_id = g.get("homeCompetitor", {}).get("id")
                a_id = g.get("awayCompetitor", {}).get("id")
                if h_id != cid and a_id != cid:
                    continue
                parsed  = _parse_game(g, comps, ctrys)
                is_home = (h_id == cid)
                w       = g.get("winner", -1)
                if w == 0:
                    result = "D"
                elif (w == 1 and is_home) or (w == 2 and not is_home):
                    result = "W"
                else:
                    result = "L"
                parsed["result"]  = result
                parsed["is_home"] = is_home
                found.append(parsed)
                if len(found) >= limit:
                    break

        return jsonify({"form": found, "competitor_id": competitor_id})
    except Exception as e:
        return jsonify({"error": str(e), "form": []}), 500


# ── /h2h ─────────────────────────────────────────────────────────────────
@app.route("/h2h")
def h2h():
    """
    GET /h2h?home_id=5936&away_id=73956&limit=8
    Scans last ~90 days to find H2H encounters between two teams.
    """
    home_id = request.args.get("home_id", "")
    away_id = request.args.get("away_id", "")
    limit   = min(int(request.args.get("limit", "8")), 20)
    if not home_id or not away_id:
        return jsonify({"error": "home_id and away_id required"}), 400

    try:
        hid   = int(home_id)
        aid   = int(away_id)
        today = datetime.now()
        found = []

        for delta in range(0, 91, 3):
            if len(found) >= limit:
                break
            api_date = (today - timedelta(days=delta)).strftime("%d/%m/%Y")
            games, comps, ctrys = _fetch_day(api_date)

            for g in games:
                if g.get("statusGroup") != 4:
                    continue
                g_hid = g.get("homeCompetitor", {}).get("id")
                g_aid = g.get("awayCompetitor", {}).get("id")
                pair  = {g_hid, g_aid}
                if {hid, aid} == pair or {hid, aid}.issubset(pair):
                    found.append(_parse_game(g, comps, ctrys))
                    if len(found) >= limit:
                        break

        return jsonify({"h2h": found, "home_id": home_id, "away_id": away_id})
    except Exception as e:
        return jsonify({"error": str(e), "h2h": []}), 500


# ── /standings ────────────────────────────────────────────────────────────
@app.route("/standings")
def standings():
    """
    GET /standings?competition_id=5455
    Derives a standings-like table from the last 60 days of results.
    """
    comp_id = request.args.get("competition_id", "")
    if not comp_id:
        return jsonify({"error": "competition_id required"}), 400

    try:
        cid   = int(comp_id)
        today = datetime.now()
        table: dict = {}   # team_id → stats

        # Scan in 1-day steps for last 2 weeks, then weekly for the rest
        steps = list(range(0, 14)) + list(range(14, 90, 7))
        for delta in steps:
            api_date = (today - timedelta(days=delta)).strftime("%d/%m/%Y")
            games, comps, ctrys = _fetch_day(api_date)

            for g in games:
                if g.get("competitionId") != cid:
                    continue
                if g.get("statusGroup") != 4:
                    continue
                home = g.get("homeCompetitor", {})
                away = g.get("awayCompetitor", {})
                hs   = home.get("score")
                as_  = away.get("score")
                if hs is None or as_ is None:
                    continue

                for team, scored, conceded, is_home in [
                    (home, int(hs), int(as_), True),
                    (away, int(as_), int(hs), False),
                ]:
                    tid = team.get("id")
                    if tid not in table:
                        table[tid] = {
                            "team_id": tid, "team": team.get("name", ""),
                            "played": 0, "wins": 0, "draws": 0, "losses": 0,
                            "goals_for": 0, "goals_against": 0, "points": 0,
                        }
                    t = table[tid]
                    t["played"]        += 1
                    t["goals_for"]     += scored
                    t["goals_against"] += conceded
                    w = g.get("winner", -1)
                    if w == 0:
                        t["draws"]  += 1; t["points"] += 1
                    elif (w == 1 and is_home) or (w == 2 and not is_home):
                        t["wins"]   += 1; t["points"] += 3
                    else:
                        t["losses"] += 1

        rows = sorted(
            table.values(),
            key=lambda x: (-x["points"], -(x["goals_for"] - x["goals_against"]), -x["goals_for"])
        )
        for i, r in enumerate(rows, 1):
            r["position"]  = i
            r["goal_diff"] = r["goals_for"] - r["goals_against"]

        return jsonify({"standings": rows, "competition_id": comp_id, "note": "Derived from last 60 days"})
    except Exception as e:
        return jsonify({"error": str(e), "standings": []}), 500


# ─── Boot ─────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(host="0.0.0.0", port=port, debug=False)
