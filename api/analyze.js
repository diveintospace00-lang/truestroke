const { GoogleAuth } = require('google-auth-library');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { videoUrl } = req.body;

        // 1. Parse the Service Account JSON from Vercel Environment Variables
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        const projectId = credentials.project_id;

        // 2. Authenticate using the Service Account
        const auth = new GoogleAuth({
            credentials,
            scopes: 'https://www.googleapis.com/auth/cloud-platform'
        });
        const client = await auth.getClient();
        const tokenResponse = await client.getAccessToken();
        const accessToken = tokenResponse.token;

        // 3. Call Gemini 1.5 Flash via the Vertex AI Endpoint (This is the fix!)
        const prompt = "You are an expert PGA golf coach. Analyze this golf swing video. Provide a brief summary, list 2 critical flaws, and provide 2 specific drills to fix them. Format your response EXACTLY like this, using HTML tags:\n\nSUMMARY:\n<p>your summary here</p>\n\nFLAWS:\n<ul><li>flaw 1</li><li>flaw 2</li></ul>\n\nDRILLS:\n<ul><li>drill 1</li><li>drill 2</li></ul>";

        const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-1.5-flash:generateContent`;

        const requestBody = {
            contents: [{
                role: "user",
                parts: [
                    { text: prompt },
                    { file_data: { file_uri: videoUrl, mime_type: "video/mp4" } }
                ]
            }]
        };

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
            throw new Error(data.error?.message || "Vertex AI request failed");
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
