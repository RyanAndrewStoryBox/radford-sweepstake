// ── update-standings.js ───────────────────────────────────────────────────────
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

    // Log all unique stages seen in the API for debugging
    const seenStages = [...new Set((matchesData.matches || []).map(m => m.stage))];
    console.log('Stages seen in API:', seenStages);

    // Build knockout progress map — cast a wide net on stage names
    const knockoutProgress = {};
    const knockoutStageMap = {
      'ROUND_OF_32':    'Round of 32',
      'LAST_32':        'Round of 32',
      'ROUND_OF_16':    'Round of 16',
      'LAST_16':        'Round of 16',
      'QUARTER_FINALS': 'Quarter-Final',
      'QUARTER_FINAL':  'Quarter-Final',
      'SEMI_FINALS':    'Semi-Final',
      'SEMI_FINAL':     'Semi-Final',
      'THIRD_PLACE':    'Third Place',
      'THIRD_PLACE_MATCH': 'Third Place',
      'FINAL':          'Final',
    };

    if (matchesData.matches) {
      matchesData.matches.forEach(match => {
        const stageLabel = knockoutStageMap[match.stage];
        if (!stageLabel) return; // skip group stage matches
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
          winner = homePen >= awayPen ? homeTeam : awayTeam;
          loser  = homePen >= awayPen ? awayTeam : homeTeam;
        }

        knockoutProgress[loser]  = { eliminatedAt: stageLabel };
        // Only update winner if not already eliminated in a later round
        if (!knockoutProgress[winner]?.eliminatedAt) {
          knockoutProgress[winner] = { reached: stageLabel };
        }
      });
    }

    console.log('Knockout progress:', JSON.stringify(knockoutProgress));

    // Save to Supabase
    await fetch(`${SUPABASE_URL}/rest/v1/standings`, {
      method: 'POST', headers: sbHeaders,
      body: JSON.stringify({
        id: 'wc2026',
        data: {
          groups: standingsData.standings || [],
          knockoutProgress,
          seenStages, // store for debugging
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
        knockoutTeams: Object.keys(knockoutProgress).length,
        seenStages
      })
    };

  } catch(e) {
    console.error('update-standings error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
