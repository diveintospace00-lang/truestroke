const { GoogleAuth } = require('google-auth-library');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { videoUrl } = req.body;

        // 1. Authenticate using the Service Account JSON
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        const auth = new GoogleAuth({
            credentials,
            scopes: 'https://www.googleapis.com/auth/cloud-platform'
        });
        const client = await auth.getClient();
        const tokenResponse = await client.getAccessToken();
        const accessToken = tokenResponse.token;

        // 2. Call Gemini 1.5 Flash
        const prompt = "You are an expert PGA golf coach. Analyze this golf swing video. Provide a brief summary, list 2 critical flaws, and provide 2 specific drills to fix them. Format your response EXACTLY like this, using HTML tags:\n\nSUMMARY:\n<p>your summary here</p>\n\nFLAWS:\n<ul><li>flaw 1</li><li>flaw 2</li></ul>\n\nDRILLS:\n<ul><li>drill 1</li><li>drill 2</li></ul>";

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`;

        const requestBody = {
            contents: [{
                parts: [
                    { text: prompt },
                    { file_data: { file_uri: videoUrl, mime_type: "video/mp4" } }
                ]
            }]
        };

        // 3. Make the request to Google
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error?.message || "Gemini API request failed");
        }

        if (data.candidates && data.candidates.length > 0) {
            const aiText = data.candidates[0].content.parts[0].text;
            res.status(200).json({ text: aiText });
        } else {
            throw new Error("AI could not analyze this video.");
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
}
