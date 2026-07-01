// ── update-standings.js ───────────────────────────────────────────────────────
const COMPETITION_ID = 2000;

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
      return { statusCode: 502, body: JSON.stringify({ error: 'Standings fetch failed', detail: err }) };
    }
    const standingsData = await standingsRes.json();

    // Fetch scorers
    const scorersRes = await fetch(
      `https://api.football-data.org/v4/competitions/${COMPETITION_ID}/scorers?limit=50`,
      { headers: apiHeaders }
    );
    if (!scorersRes.ok) {
      const err = await scorersRes.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Scorers fetch failed', detail: err }) };
    }
    const scorersData = await scorersRes.json();

    // Fetch knockout matches by stage explicitly to avoid pagination issues
    const knockoutStageIds = ['LAST_32', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'THIRD_PLACE', 'FINAL'];
    const stageLabels = {
      'LAST_32':        'Round of 32',
      'LAST_16':        'Round of 16',
      'QUARTER_FINALS': 'Quarter-Final',
      'SEMI_FINALS':    'Semi-Final',
      'THIRD_PLACE':    'Third Place',
      'FINAL':          'Final',
    };
    const stageOrder = ['LAST_32','LAST_16','QUARTER_FINALS','SEMI_FINALS','THIRD_PLACE','FINAL'];

    // Fetch all knockout matches across all stages
    const allKnockoutMatches = [];
    for (const stage of knockoutStageIds) {
      try {
        const res = await fetch(
          `https://api.football-data.org/v4/competitions/${COMPETITION_ID}/matches?stage=${stage}&status=FINISHED`,
          { headers: apiHeaders }
        );
        if (res.ok) {
          const d = await res.json();
          if (d.matches) allKnockoutMatches.push(...d.matches);
        }
      } catch(e) {
        console.log(`Failed to fetch stage ${stage}:`, e.message);
      }
    }

    console.log('Total knockout matches fetched:', allKnockoutMatches.length);

    // Sort by stage order so later rounds overwrite earlier ones
    allKnockoutMatches.sort((a, b) => stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage));

    const knockoutProgress = {};
    allKnockoutMatches.forEach(match => {
      const stageLabel = stageLabels[match.stage];
      if (!stageLabel) return;

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
      knockoutProgress[winner] = { reached: stageLabel };
    });

    console.log('Knockout progress entries:', Object.keys(knockoutProgress).length);
    console.log(JSON.stringify(knockoutProgress));

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
        knockoutTeams: Object.keys(knockoutProgress).length,
        knockoutProgress
      })
    };

  } catch(e) {
    console.error('update-standings error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
