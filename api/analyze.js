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

Measured metrics WITH VERDICTS (verdicts were computed by deterministic code from coaching threshold ranges — they are correct; do NOT contradict them or re-judge the numbers yourself):
${assess(metrics, angle)}

Name the 1–2 most important improvement areas based ONLY on metrics whose verdict is not GOOD. NEVER list a GOOD metric as a flaw. If only one metric needs work, give one flaw and one matching drill, and praise the rest — do not invent a second flaw. Give one specific, actionable drill per flaw. Keep each flaw and drill to 1–2 sentences. Be encouraging but direct.

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

// Deterministic metric verdicts — code judges the numbers, the model only writes prose.
function assess(m, angle) {
    const lines = [];
    // Face-on rotation numbers are depth-based estimates. An out-of-range value at
    // this angle gets an ESTIMATE verdict so the model cannot make it a primary flaw.
    const rotEst = angle === 'face-on';
    const soften = (verdict) => {
        if (!rotEst || verdict.startsWith('GOOD')) return verdict;
        return 'ESTIMATE ONLY — outside the typical range, but measured face-on where rotation is unreliable; mention at most as a side note, NEVER as a primary flaw (' + verdict + ')';
    };

    const t = m.tempo_ratio;
    let tv;
    if (t >= 2.5 && t <= 3.5) tv = 'GOOD — right around the ideal 3:1';
    else if (t >= 2.0 && t < 2.5) tv = 'SLIGHTLY QUICK — downswing a touch rushed vs the ideal 3:1';
    else if (t > 3.5 && t <= 4.2) tv = 'SLIGHTLY SLOW — backswing a touch long vs the ideal 3:1';
    else if (t < 2.0) tv = 'NEEDS WORK — downswing is rushed (ideal ~3:1)';
    else tv = 'NEEDS WORK — tempo is sluggish (ideal ~3:1)';
    lines.push(`- Tempo ${t}:1 — VERDICT: ${tv}`);

    const st = m.shoulder_turn;
    let sv;
    if (st >= 75 && st <= 110) sv = 'GOOD — full shoulder turn';
    else if (st < 75) sv = 'NEEDS WORK — restricted shoulder turn (ideal ~90°)';
    else sv = 'WATCH — possible over-rotation (ideal ~90°)';
    lines.push(`- Shoulder turn ${st}° — VERDICT: ${soften(sv)}`);

    const h = m.hip_rotation;
    let hv;
    if (h >= 30 && h <= 55) hv = 'GOOD — solid hip turn';
    else if (h < 30) hv = 'NEEDS WORK — restricted hip turn (ideal ~45°)';
    else hv = 'WATCH — hips may be over-rotating (ideal ~45°)';
    lines.push(`- Hip rotation ${h}° — VERDICT: ${soften(hv)}`);

    const x = m.x_factor;
    let xv;
    if (x >= 25 && x <= 55) xv = 'GOOD — healthy shoulder-hip separation';
    else if (x < 25) xv = 'NEEDS WORK — low separation, costing stored power (ideal ~40–50°)';
    else xv = 'WATCH — very high separation; ensure flexibility supports it';
    lines.push(`- X-Factor ${x}° — VERDICT: ${soften(xv)}`);

    const sp = Math.abs(m.spine_angle_change);
    let pv;
    if (sp <= 8) pv = 'GOOD — posture held through impact';
    else if (sp <= 16) pv = 'WATCH — moderate posture change into impact';
    else pv = 'NEEDS WORK — significant posture change into impact (early extension or sway)';
    lines.push(`- Spine angle change ${m.spine_angle_change}° — VERDICT: ${pv}`);

    return lines.join('\n');
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
