// api/delete-account.js — permanently deletes the calling user's account and all data.
// Fulfills the Privacy Policy's deletion promise. Requires SUPABASE_SERVICE_ROLE_KEY
// in Vercel env vars (Settings → Environment Variables). That key is a SERVER-ONLY
// secret — it must never appear in any HTML/JS file.

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) {
        return res.status(500).json({ error: 'Server is missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY env vars.' });
    }

    // 1. Verify the caller: the token must belong to a real, current session.
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not signed in.' });

    let userId;
    try {
        const who = await fetch(url + '/auth/v1/user', {
            headers: { 'apikey': anonKey, 'Authorization': 'Bearer ' + token },
        });
        if (!who.ok) return res.status(401).json({ error: 'Invalid session.' });
        const user = await who.json();
        userId = user.id;
        if (!userId) return res.status(401).json({ error: 'Invalid session.' });
    } catch (e) {
        return res.status(500).json({ error: 'Could not verify session: ' + e.message });
    }

    const svc = { 'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };
    try {
        // 2. Delete all of the user's stored videos (list their folder, then remove).
        const listResp = await fetch(url + '/storage/v1/object/list/swing-videos', {
            method: 'POST',
            headers: svc,
            body: JSON.stringify({ prefix: userId + '/', limit: 1000 }),
        });
        if (listResp.ok) {
            const objects = await listResp.json();
            const paths = (objects || []).map(o => userId + '/' + o.name).filter(p => !p.endsWith('/'));
            if (paths.length) {
                await fetch(url + '/storage/v1/object/swing-videos', {
                    method: 'DELETE',
                    headers: svc,
                    body: JSON.stringify({ prefixes: paths }),
                });
            }
        }

        // 3. Delete their analysis history.
        await fetch(url + '/rest/v1/swing_analyses?user_id=eq.' + userId, {
            method: 'DELETE',
            headers: svc,
        });

        // 4. Delete the auth user itself.
        const delUser = await fetch(url + '/auth/v1/admin/users/' + userId, {
            method: 'DELETE',
            headers: svc,
        });
        if (!delUser.ok) {
            const t = await delUser.text().catch(() => '');
            return res.status(500).json({ error: 'Data was removed but the account record could not be deleted (' + delUser.status + '): ' + t.slice(0, 150) });
        }

        return res.status(200).json({ deleted: true });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
