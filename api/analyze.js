export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { frames } = req.body; 

        const GROQ_API_KEY = process.env.GROQ_API_KEY;

        const prompt = "You are an expert PGA golf coach. I am providing 4 sequential frames from a golf swing video (setup, top of swing, impact, follow-through). Analyze the swing mechanics. Provide a brief summary, list 2 critical flaws, and provide 2 specific drills to fix them. Format your response EXACTLY like this, using HTML tags:\n\nSUMMARY:\n<p>your summary here</p>\n\nFLAWS:\n<ul><li>flaw 1</li><li>flaw 2</li></ul>\n\nDRILLS:\n<ul><li>drill 1</li><li>drill 2</li></ul>";

        const contentArray = [{ type: "text", text: prompt }];
        for (let i = 0; i < frames.length; i++) {
            contentArray.push({ type: "image_url", image_url: { url: frames[i] } });
        }

        const messages = [
            { role: "user", content: contentArray }
        ];

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: "llama-3.2-90b-vision-preview",
                messages: messages
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error?.message || "Groq API request failed");
        }

        if (data.choices && data.choices.length > 0) {
            const aiText = data.choices[0].message.content;
            res.status(200).json({ text: aiText });
        } else {
            throw new Error("AI could not analyze this swing.");
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
}
