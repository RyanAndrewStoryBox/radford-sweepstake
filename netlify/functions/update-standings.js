// ── update-standings.js ───────────────────────────────────────────────────────
const COMPETITION_ID = 2000;

// ── MANUAL KNOCKOUT OVERRIDES ─────────────────────────────────────────────────
// Only add teams when they are ELIMINATED. Teams not listed here show as "Still in".
// Stages: 'Round of 32', 'Round of 16', 'Quarter-Final', 'Semi-Final', 'Third Place', 'Final'
const MANUAL_KNOCKOUT = {
  // ELIMINATED IN ROUND OF 32
  'South Africa':  { eliminatedAt: 'Round of 32' },
  'Japan':         { eliminatedAt: 'Round of 32' },
  'Germany':       { eliminatedAt: 'Round of 32' },
  'Netherlands':   { eliminatedAt: 'Round of 32' },
  "Côte d'Ivoire": { eliminatedAt: 'Round of 32' },
  'Sweden':        { eliminatedAt: 'Round of 32' },
  'Ecuador':       { eliminatedAt: 'Round of 32' },
  'DR Congo':      { eliminatedAt: 'Round of 32' },
  // ADD ELIMINATIONS HERE AS THEY HAPPEN e.g.:
  // 'Brazil': { eliminatedAt: 'Round of 16' },
};

exports.handler = async function(event, context) {
  const CRON_SECRET = process.env.CRON_SECRET || 'radford-cron';
  const body = event.body ? JSON.parse(event.body) : {};
  if (event.httpMethod === 'POST' && body.secret !== CRON_SECRET) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!FOOTBALL_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  const apiHeaders = { 'X-Auth-Token': FOOTBALL_API_KEY };
  const sbHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Prefer': 'resolution=merge-duplicates'
  };

  try {
    const standingsRes = await fetch(
      `https://api.football-data.org/v4/competitions/${COMPETITION_ID}/standings`,
      { headers: apiHeaders }
    );
    if (!standingsRes.ok) {
      const err = await standingsRes.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Standings fetch failed', detail: err }) };
    }
    const standingsData = await standingsRes.json();

    const scorersRes = await fetch(
      `https://api.football-data.org/v4/competitions/${COMPETITION_ID}/scorers?limit=50`,
      { headers: apiHeaders }
    );
    if (!scorersRes.ok) {
      const err = await scorersRes.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Scorers fetch failed', detail: err }) };
    }
    const scorersData = await scorersRes.json();

    await fetch(`${SUPABASE_URL}/rest/v1/standings`, {
      method: 'POST', headers: sbHeaders,
      body: JSON.stringify({
        id: 'wc2026',
        data: {
          groups: standingsData.standings || [],
          knockoutProgress: MANUAL_KNOCKOUT,
          updatedAt: new Date().toISOString()
        }
      })
    });

    await fetch(`${SUPABASE_URL}/rest/v1/scorers`, {
      method: 'POST', headers: sbHeaders,
      body: JSON.stringify({
        id: 'wc2026',
        data: {
          scorers: scorersData.scorers || [],
          updatedAt: new Date().toISOString()
        }
      })
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        groups: standingsData.standings?.length || 0,
        scorers: scorersData.scorers?.length || 0,
        knockoutTeams: Object.keys(MANUAL_KNOCKOUT).length
      })
    };

  } catch(e) {
    console.error('update-standings error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
