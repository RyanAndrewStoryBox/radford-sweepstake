// ── update-standings.js ───────────────────────────────────────────────────────
// Called by cron-job.org every 2 hours during the tournament.
// Fetches standings + scorers from football-data.org and writes to Supabase.

const COMPETITION_ID = 2000; // FIFA World Cup

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
    // Fetch group standings
    const standingsRes = await fetch(
      `https://api.football-data.org/v4/competitions/${COMPETITION_ID}/standings`,
      { headers: apiHeaders }
    );
    if (!standingsRes.ok) {
      const err = await standingsRes.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Standings fetch failed', detail: err }) };
    }
    const standingsData = await standingsRes.json();

    // Fetch top scorers
    const scorersRes = await fetch(
      `https://api.football-data.org/v4/competitions/${COMPETITION_ID}/scorers?limit=50`,
      { headers: apiHeaders }
    );
    if (!scorersRes.ok) {
      const err = await scorersRes.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Scorers fetch failed', detail: err }) };
    }
    const scorersData = await scorersRes.json();

    // Fetch matches for knockout progress tracking
    const matchesRes = await fetch(
      `https://api.football-data.org/v4/competitions/${COMPETITION_ID}/matches`,
      { headers: apiHeaders }
    );
    const matchesData = matchesRes.ok ? await matchesRes.json() : { matches: [] };

    // Build knockout progress map: teamName -> status
    const knockoutProgress = {};
    const knockoutStages = ['ROUND_OF_32','ROUND_OF_16','QUARTER_FINALS','SEMI_FINALS','THIRD_PLACE','FINAL'];
    const stageLabels = {
      'ROUND_OF_32': 'Round of 32',
      'ROUND_OF_16': 'Round of 16',
      'QUARTER_FINALS': 'Quarter-Final',
      'SEMI_FINALS': 'Semi-Final',
      'THIRD_PLACE': 'Third Place',
      'FINAL': 'Final'
    };

    if (matchesData.matches) {
      matchesData.matches.forEach(match => {
        if (!knockoutStages.includes(match.stage)) return;
        if (match.status !== 'FINISHED') return;
        const homeTeam = match.homeTeam.name;
        const awayTeam = match.awayTeam.name;
        const homeGoals = match.score.fullTime.home;
        const awayGoals = match.score.fullTime.away;
        let winner, loser;
        if (homeGoals !== awayGoals) {
          winner = homeGoals > awayGoals ? homeTeam : awayTeam;
          loser  = homeGoals > awayGoals ? awayTeam : homeTeam;
        } else {
          const homePen = match.score.penalties?.home || 0;
          const awayPen = match.score.penalties?.away || 0;
          winner = homePen > awayPen ? homeTeam : awayTeam;
          loser  = homePen > awayPen ? awayTeam : homeTeam;
        }
        const label = stageLabels[match.stage] || match.stage;
        knockoutProgress[loser]  = { eliminatedAt: label };
        knockoutProgress[winner] = { reached: label };
      });
    }

    // Save to Supabase
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
        groups: standingsData.standings?.length || 0,
        scorers: scorersData.scorers?.length || 0,
        knockoutTeams: Object.keys(knockoutProgress).length
      })
    };

  } catch(e) {
    console.error('update-standings error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
