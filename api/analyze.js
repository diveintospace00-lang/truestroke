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
    const angle = body.angle === 'face-on' || body.angle === 'dtl' ? body.angle : 'unknown';
    const angleContext = angle === 'face-on'
        ? 'The video was filmed FACE-ON (camera facing the golfer). At this angle, tempo and spine/posture numbers are reliable, but shoulder/hip rotation values are rough estimates — do NOT build your primary critique on exact rotation degrees. Lead with tempo and posture; mention rotation only directionally.'
        : angle === 'dtl'
        ? 'The video was filmed DOWN-THE-LINE (camera behind the hands, aimed at the target). At this angle, rotation numbers (shoulder turn, hip turn, X-Factor) and spine angle are reliable — you can coach confidently on them.'
        : 'The camera angle is unknown; treat rotation values as approximate.';

    const prompt = `You are an expert PGA golf coach analyzing a swing measured by computer vision (single-camera pose estimation, so treat values as good estimates rather than launch-monitor exact).

${angleContext}

Measured metrics:
- Shoulder turn at top: ${metrics.shoulder_turn}°  (ideal ~90°)
- Hip rotation at top: ${metrics.hip_rotation}°  (ideal ~45°)
- X-Factor (shoulder minus hip separation): ${metrics.x_factor}°  (ideal ~40–50°)
- Spine angle change, address to impact: ${metrics.spine_angle_change}°  (smaller is better; large change suggests early extension / loss of posture)
- Tempo ratio, backswing : downswing: ${metrics.tempo_ratio} : 1  (ideal ~3 : 1)

Identify the 2 most important flaws these numbers suggest and give 2 specific, actionable drills that fix them. Keep each flaw and drill to 1–2 sentences. Be encouraging but direct.

Respond in EXACTLY this plain-text line format — no JSON, no markdown, no extra lines:
SUMMARY: <2-3 sentence overview>
FLAW: <first flaw>
FLAW: <second flaw>
DRILL: <first drill>
DRILL: <second drill>`;

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

// Line-based parse: immune to stray quotes/JSON breakage from the model.
function parseCoaching(raw) {
    const text = raw.replace(/```/g, '').trim();
    const out = { summary: '', flaws: [], drills: [] };
    for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (/^SUMMARY\s*:/i.test(t)) out.summary = t.replace(/^SUMMARY\s*:/i, '').trim();
        else if (/^FLAW\s*:/i.test(t)) out.flaws.push(t.replace(/^FLAW\s*:/i, '').trim());
        else if (/^DRILL\s*:/i.test(t)) out.drills.push(t.replace(/^DRILL\s*:/i, '').trim());
        else if (out.summary && !out.flaws.length && !out.drills.length && t) out.summary += ' ' + t; // wrapped summary lines
    }
    out.flaws = out.flaws.filter(Boolean);
    out.drills = out.drills.filter(Boolean);
    // Total failure fallback: show the raw text rather than nothing.
    if (!out.summary && !out.flaws.length && !out.drills.length) out.summary = text;
    return out;
}
