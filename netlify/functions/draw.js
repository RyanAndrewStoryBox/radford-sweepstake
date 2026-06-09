const Pusher = require("pusher");

exports.handler = async function(event, context) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { action, data, password } = JSON.parse(event.body || "{}");

  if (password !== process.env.HOST_PASSWORD) {
    return { statusCode: 403, body: JSON.stringify({ error: "Wrong password" }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  // Reset — delete all draws
  if (action === "reset") {
    try {
      await fetch(`${supabaseUrl}/rest/v1/draws?id=neq.null`, {
        method: "DELETE",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      });
    } catch(e) {
      return { statusCode: 500, body: JSON.stringify({ error: "Reset failed" }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  // Broadcast via Pusher
  const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true,
  });

  await pusher.trigger("sweepstake", action, data);

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true }),
  };
};
