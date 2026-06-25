export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { frames } = req.body; // Now receiving 6 images

        const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

        const prompt = "You are an expert PGA golf coach. I am providing 6 sequential frames from a golf swing video (setup, takeaway, top of swing, transition, impact, follow-through). Analyze the swing mechanics. Provide a brief summary, list 2 critical flaws, and provide 2 specific drills to fix them. Format your response EXACTLY like this, using HTML tags:\n\nSUMMARY:\n<p>your summary here</p>\n\nFLAWS:\n<ul><li>flaw 1</li><li>flaw 2</li></ul>\n\nDRILLS:\n<ul><li>drill 1</li><li>drill 2</li></ul>";

        // Build the content array with all 6 frames
        const contentArray = [
            { type: "text", text: prompt }
        ];

        for (let i = 0; i < frames.length; i++) {
            contentArray.push({
                type: "image_url",
                image_url: { url: frames[i] }
            });
        }

        const messages = [
            {
                role: "system",
                content: "You are an expert PGA golf coach."
            },
            {
                role: "user",
                content: contentArray
            }
        ];

        const response = await fetch('https://models.inference.ai.azure.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GITHUB_TOKEN}`
            },
            body: JSON.stringify({
                model: "Llama-3.2-90B-Vision-Instruct",
                messages: messages
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error?.message || "GitHub Models API request failed");
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
