// ── update-standings.js ───────────────────────────────────────────────────────
const COMPETITION_ID = 2000;

const stageLabels = {
  'LAST_32':        'Round of 32',
  'ROUND_OF_32':    'Round of 32',
  'LAST_16':        'Round of 16',
  'ROUND_OF_16':    'Round of 16',
  'QUARTER_FINALS': 'Quarter-Final',
  'QUARTER_FINAL':  'Quarter-Final',
  'SEMI_FINALS':    'Semi-Final',
  'SEMI_FINAL':     'Semi-Final',
  'THIRD_PLACE':    'Third Place',
  'THIRD_PLACE_MATCH': 'Third Place',
  'FINAL':          'Final',
};

const stageOrder = [
  'LAST_32','ROUND_OF_32',
  'LAST_16','ROUND_OF_16',
  'QUARTER_FINALS','QUARTER_FINAL',
  'SEMI_FINALS','SEMI_FINAL',
  'THIRD_PLACE','THIRD_PLACE_MATCH',
  'FINAL'
];

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
    // Fetch standings
    const standingsRes = await fetch(
      `https://api.football-data.org/v4/competitions/${COMPETITION_ID}/standings`,
      { headers: apiHeaders }
    );
    if (!standingsRes.ok) {
      const err = await standingsRes.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Standings failed', detail: err }) };
    }
    const standingsData = await standingsRes.json();

    // Fetch scorers
    const scorersRes = await fetch(
      `https://api.football-data.org/v4/competitions/${COMPETITION_ID}/scorers?limit=50`,
      { headers: apiHeaders }
    );
    if (!scorersRes.ok) {
      const err = await scorersRes.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Scorers failed', detail: err }) };
    }
    const scorersData = await scorersRes.json();

    // Fetch ALL finished matches — this gets every completed match across all stages
    const matchesRes = await fetch(
      `https://api.football-data.org/v4/competitions/${COMPETITION_ID}/matches?status=FINISHED`,
      { headers: apiHeaders }
    );
    const matchesData = matchesRes.ok ? await matchesRes.json() : { matches: [] };

    const allMatches = matchesData.matches || [];
    console.log('Total finished matches:', allMatches.length);
    console.log('Stages seen:', [...new Set(allMatches.map(m => m.stage))]);

    // Filter to knockout matches only and sort by stage progression
    const knockoutMatches = allMatches
      .filter(m => stageLabels[m.stage])
      .sort((a, b) => stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage));

    console.log('Knockout matches:', knockoutMatches.length);

    // Build knockout progress — process in order so later rounds overwrite earlier
    const knockoutProgress = {};
    knockoutMatches.forEach(match => {
      const label = stageLabels[match.stage];
      const home = match.homeTeam.name;
      const away = match.awayTeam.name;
      const hg = match.score.fullTime.home;
      const ag = match.score.fullTime.away;

      let winner, loser;
      if (hg !== ag) {
        winner = hg > ag ? home : away;
        loser  = hg > ag ? away : home;
      } else {
        const hp = match.score.penalties?.home || 0;
        const ap = match.score.penalties?.away || 0;
        winner = hp >= ap ? home : away;
        loser  = hp >= ap ? away : home;
      }

      // Always overwrite — later rounds replace earlier entries
      knockoutProgress[loser]  = { eliminatedAt: label };
      knockoutProgress[winner] = { reached: label };
    });

    console.log('Knockout progress:', JSON.stringify(knockoutProgress));

    await fetch(`${SUPABASE_URL}/rest/v1/standings`, {
      method: 'POST', headers: sbHeaders,
      body: JSON.stringify({
        id: 'wc2026',
        data: {
          groups: standingsData.standings || [],
          knockoutProgress,
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
        finishedMatches: allMatches.length,
        knockoutMatches: knockoutMatches.length,
        knockoutTeams: Object.keys(knockoutProgress).length,
        knockoutProgress
      })
    };

  } catch(e) {
    console.error('update-standings error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
