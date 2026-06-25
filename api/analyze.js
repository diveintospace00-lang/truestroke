// api/analyze.js — Vercel serverless function (Node runtime)
// Receives computed swing metrics (numbers only), asks Groq for coaching,
// and returns structured JSON: { summary, flaws[], drills[] }.

const LLM_CONFIG = {
    // NOTE: llama-3.1-8b-instant was DEPRECATED on Groq (June 17, 2026).
    // Using its recommended replacement. Swap this one line to change models:
    //   "openai/gpt-oss-120b"  -> higher quality coaching text
    //   "openai/gpt-oss-20b"   -> faster, higher daily rate limit (current default)
    model: "openai/gpt-oss-20b",
    apiUrl: "https://api.groq.com/openai/v1/chat/completions",
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const API_KEY = process.env.GROQ_API_KEY;
    if (!API_KEY) {
        return res.status(500).json({ error: 'Server is missing GROQ_API_KEY. Add it in Vercel → Settings → Environment Variables.' });
    }

    // Vercel parses JSON bodies for Node functions, but guard for safety.
    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
    }
    const metrics = body && body.metrics;
    if (!metrics || typeof metrics !== 'object') {
        return res.status(400).json({ error: 'Missing "metrics" in request body.' });
    }

    const prompt = `You are an expert PGA golf coach analyzing a swing measured by computer vision (single-camera pose estimation, so treat values as good estimates rather than launch-monitor exact).

Measured metrics:
- Shoulder turn at top: ${metrics.shoulder_turn}°  (ideal ~90°)
- Hip rotation at top: ${metrics.hip_rotation}°  (ideal ~45°)
- X-Factor (shoulder minus hip separation): ${metrics.x_factor}°  (ideal ~40–50°)
- Spine angle change, address to impact: ${metrics.spine_angle_change}°  (smaller is better; large change suggests early extension / loss of posture)
- Tempo ratio, backswing : downswing: ${metrics.tempo_ratio} : 1  (ideal ~3 : 1)

Identify the 2 most important flaws these numbers suggest and give 2 specific, actionable drills that fix them. Keep each flaw and drill to 1–2 sentences. Be encouraging but direct.

Respond with ONLY a valid JSON object, no markdown, no code fences, in exactly this shape:
{"summary": "2-3 sentence overview", "flaws": ["flaw 1", "flaw 2"], "drills": ["drill 1", "drill 2"]}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    try {
        const response = await fetch(LLM_CONFIG.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
            },
            body: JSON.stringify({
                model: LLM_CONFIG.model,
                temperature: 0.6,
                messages: [{ role: 'user', content: prompt }],
            }),
            signal: controller.signal,
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error?.message || `LLM request failed (${response.status})`);
        }

        const raw = data.choices?.[0]?.message?.content || '';
        const parsed = parseCoaching(raw);
        return res.status(200).json(parsed);
    } catch (error) {
        const msg = error.name === 'AbortError' ? 'The AI coach timed out. Please try again.' : error.message;
        return res.status(500).json({ error: msg });
    } finally {
        clearTimeout(timeout);
    }
}

// Defensive parse: strip any code fences, try JSON, fall back to plain text.
function parseCoaching(raw) {
    let text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
    try {
        const obj = JSON.parse(text);
        return {
            summary: typeof obj.summary === 'string' ? obj.summary : '',
            flaws: Array.isArray(obj.flaws) ? obj.flaws.map(String) : [],
            drills: Array.isArray(obj.drills) ? obj.drills.map(String) : [],
        };
    } catch {
        // Model didn't return clean JSON — surface its text rather than failing.
        return { summary: raw.trim(), flaws: [], drills: [] };
    }
}
