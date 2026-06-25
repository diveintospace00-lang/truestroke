const LLM_CONFIG = {
    provider: "groq",
    model: "llama-3.1-8b-instant", // Swappable to openrouter/deepseek if needed
    apiUrl: "https://api.groq.com/openai/v1/chat/completions"
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { metrics } = req.body;
        const API_KEY = process.env.GROQ_API_KEY;

        const prompt = `You are an expert PGA golf coach. I have computed the following biomechanical metrics from a golf swing using computer vision:
        - Shoulder Turn at Top (degrees): ${metrics.shoulder_turn}
        - Hip Rotation at Top (degrees): ${metrics.hip_rotation}
        - X-Factor (Shoulder - Hip separation): ${metrics.x_factor}
        - Spine Angle Change (Address to Impact, degrees): ${metrics.spine_angle_change}
        - Tempo Ratio (Backswing to Downswing time): ${metrics.tempo_ratio}

        Based STRICTLY on these numbers, provide a brief summary, identify 2 critical flaws, and provide 2 specific drills to fix them. Format your response EXACTLY like this, using HTML tags:
        SUMMARY:
        <p>your summary here</p>
        FLAWS:
        <ul><li>flaw 1</li><li>flaw 2</li></ul>
        DRILLS:
        <ul><li>drill 1</li><li>drill 2</li></ul>`;

        const response = await fetch(LLM_CONFIG.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: LLM_CONFIG.model,
                messages: [{ role: "user", content: prompt }]
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "LLM request failed");

        res.status(200).json({ text: data.choices[0].message.content });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
