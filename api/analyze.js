// api/analyze.js — Vercel serverless function (Node runtime)
// Receives computed swing metrics (numbers only), asks Groq for coaching,
// and returns structured JSON: { summary, flaws[], drills[] }.

// ============================================================
// DRILL LIBRARY — curated by you, the golfer. The AI never invents drills or
// links; code picks from this list based on the detected flaws.
//
// TO FILL IN: search YouTube using each drill's 'search' terms (these are the
// names golf instructors actually use), watch
// it fully, and paste the link over PASTE_YOUTUBE_LINK_HERE. Drills without a
// real link still appear in reports as text, just without a video button.
// ============================================================
const DRILL_LIBRARY = [
    { id: 'tour_tempo',   fixes: 'tempo_quick',        name: '1-2-3-ONE Tempo Drill (Tour Tempo)', video: 'https://www.youtube.com/watch?v=j1e15G9PMqg', search: 'Tour Tempo drill OR 1-2-3-1 golf tempo',
      how: 'Count out loud as you swing: "one-two-three" for the backswing, "ONE" for the downswing. Three counts back, one count down is the 3:1 ratio the pros share. Start with half swings until the count feels automatic.' },
    { id: 'step_drill',   fixes: 'tempo_quick',        name: 'Step-Through Tempo Drill',   video: 'https://www.youtube.com/watch?v=u382ZZHdmfw', search: 'golf step drill tempo',
      how: 'Start with feet together, step toward the target with your lead foot as you start the downswing. Forces an unhurried transition and proper sequencing.' },
    { id: 'whoosh',       fixes: 'tempo_slow',         name: 'Whoosh Drill',               video: 'https://www.youtube.com/watch?v=4VbhVMVprmc', search: 'golf whoosh drill swing speed',
      how: 'Flip a club upside down, grip the shaft, and swing so the loudest whoosh happens past where the ball would be. Trains committing speed to the right moment instead of a labored backswing.' },
    { id: 'towel_turn',   fixes: 'shoulder_restricted', name: 'Cross-Arm Turn Drill',      video: 'https://www.youtube.com/shorts/uEA2c_dgTrg', search: 'golf cross arm shoulder turn drill',
      how: 'Cross your arms over your chest, get in posture, and turn until your lead shoulder is over your trail knee. Do 10 slow reps before hitting balls to feel a full turn.' },
    { id: 'hip_bump',     fixes: 'hip_restricted',     name: 'Hip Bump Drill',             video: 'https://www.youtube.com/watch?v=URfeL15PnyE', search: 'golf hip bump drill downswing',
      how: 'Place an alignment stick in the ground just outside your lead hip. Rehearse starting the downswing by bumping your hip toward the stick before your arms move.' },
    { id: 'chair_hips',   fixes: 'hip_over',           name: 'Chair Resistance Drill',     video: 'https://www.youtube.com/shorts/vkKV-LEWsNo', search: 'golf chair drill hip restriction backswing',
      how: 'Set up with your trail hip lightly touching a chair back. Make backswings keeping contact — your upper body turns fully while the hips stay quieter, restoring separation.' },
    { id: 'xfactor_stretch', fixes: 'low_separation',  name: 'X-Factor Stretch Drill',     video: 'https://www.youtube.com/watch?v=A02mGrmyZaE', search: 'golf x factor stretch drill shoulder hip separation',
      how: 'Get into your golf posture with a club held across your chest (or arms crossed). Keeping your lower body quiet — knees flexed, feet planted — turn your shoulders to the top and feel the stretch build across your core. Hold for two seconds, return, and repeat 10 times. No equipment needed.' },
    { id: 'wall_butt',    fixes: 'posture_loss',       name: 'Wall Drill (Anti-Early-Extension)', video: 'https://www.youtube.com/watch?v=xzvtN-0dRI4', search: 'golf wall drill early extension',
      how: 'Set up with your rear end lightly touching a wall. Make slow swings keeping it in contact through impact. If you lose the wall, you stood up out of posture.' },
    { id: 'towel_heels',  fixes: 'posture_loss',       name: 'Towel-Behind-the-Heels Drill', video: 'PASTE_YOUTUBE_LINK_HERE', search: 'golf towel behind heels drill stay in posture',
      how: 'Place a towel or headcover on the ground a few inches behind your heels at address. Swing to the top — if you can still see it out of the corner of your eye, your spine angle held. If it disappears, you stood up out of your posture.' },
    { id: 'feet_together', fixes: 'general',           name: 'Feet-Together Balance Drill', video: 'https://www.youtube.com/watch?v=MaWn4zp1hQ8', search: 'golf feet together drill balance tempo',
      how: 'Hit half-speed shots with your feet touching. Impossible to do without smooth tempo and balance — a great maintenance drill when nothing is broken.' },
];

// Deterministic flaw detection — same thresholds as the verdicts in assess().
// Face-on rotation flaws are suppressed (depth estimates, not coachable numbers).
function detectFlaws(m, angle) {
    const flaws = [];
    if (Math.abs(m.spine_angle_change) > 16) flaws.push('posture_loss');
    if (angle !== 'face-on') {
        if (m.shoulder_turn < 75) flaws.push('shoulder_restricted');
        if (m.hip_rotation < 30) flaws.push('hip_restricted');
        else if (m.hip_rotation > 55) flaws.push('hip_over');
        if (m.x_factor < 25) flaws.push('low_separation');
    }
    return flaws.slice(0, 2); // coach the two most important, in threshold order
}

function pickDrills(flawCats) {
    const cats = flawCats.length ? flawCats : ['general'];
    const picked = [];
    // One drill per flaw when there are two flaws; when a swing has a single
    // flaw, prescribe up to two drills for it (a fuller plan for one problem).
    const perCat = cats.length === 1 ? 2 : 1;
    for (const cat of cats) {
        const matches = DRILL_LIBRARY.filter(x => x.fixes === cat && !picked.includes(x));
        picked.push(...matches.slice(0, perCat));
    }
    return picked.map(d => ({
        name: d.name,
        how: d.how,
        video: (d.video && !d.video.includes('PASTE')) ? d.video : null,
    }));
}

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

Describe the improvement areas based ONLY on metrics whose verdict is NEEDS WORK or WATCH (never GOOD, never ESTIMATE ONLY). If nothing needs work, say so warmly — do not invent flaws. Do NOT suggest drills; a drill plan is attached separately. Keep each flaw to 1–2 sentences. Be encouraging but direct.

Respond in EXACTLY this plain-text line format — no JSON, no markdown, no extra lines (omit FLAW lines if nothing needs work):
SUMMARY: <2-3 sentence overview>
FLAW: <first improvement area>
FLAW: <second improvement area, only if genuinely warranted>`;

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
        parsed.drills = pickDrills(detectFlaws(metrics, angle));   // drills come from the curated library, never the model
        const save = await saveAnalysis(body.video_url, angle, metrics, parsed);
        parsed.saved = save.ok;
        if (!save.ok) parsed.save_error = save.reason;
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

    // Tempo ratio retired from coaching: single-camera timing of the ~0.35s
    // downswing proved noisy to ~±1, so no verdict is drawn from it. Backswing
    // duration IS reliable (±0.02s) and is reported as context, not judged.
    if (typeof m.back_time === 'number' && m.back_time > 0) {
        lines.push(`- Backswing duration ${m.back_time}s — VERDICT: CONTEXT ONLY — reliable measurement, no ideal target; do not critique it`);
    }

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

// Persist the analysis to Supabase (swing_analyses table) so users get history.
// Uses SUPABASE_URL + SUPABASE_ANON_KEY env vars (Vercel -> Settings -> Environment
// Variables). Inserts are allowed by the table's RLS policy. Never fails the
// response: if saving breaks, the user still gets their report.
async function saveAnalysis(videoUrl, angle, metrics, parsed) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) return { ok: false, reason: 'SUPABASE_URL / SUPABASE_ANON_KEY are not set in Vercel env vars (add them, then redeploy)' };
    try {
        const resp = await fetch(url.replace(/\/$/, '') + '/rest/v1/swing_analyses', {
            method: 'POST',
            headers: {
                'apikey': key,
                'Authorization': 'Bearer ' + key,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
            },
            body: JSON.stringify({
                video_url: videoUrl || null,
                analysis_text: JSON.stringify({
                    angle,
                    metrics,
                    summary: parsed.summary,
                    flaws: parsed.flaws,
                    drills: parsed.drills,
                }),
                status: 'complete',
            }),
        });
        if (!resp.ok) {
            const t = await resp.text().catch(() => '');
            return { ok: false, reason: 'Supabase rejected the insert (HTTP ' + resp.status + '): ' + t.slice(0, 200) };
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: e.message };
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
