const { GoogleGenerativeAI } = require("@google/generative-ai");

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { videoUrl } = req.body;

        // We will use standard API key here for now, but in Vercel Environment Variables
        // For Service accounts, we'd use google-auth-library. Let's start with a standard key env var.
        const API_KEY = process.env.GEMINI_API_KEY; 
        const genAI = new GoogleGenerativeAI(API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = "You are an expert PGA golf coach. Analyze this golf swing video. Provide a brief summary, list 2 critical flaws, and provide 2 specific drills to fix them. Format your response EXACTLY like this, using HTML tags:\n\nSUMMARY:\n<p>your summary here</p>\n\nFLAWS:\n<ul><li>flaw 1</li><li>flaw 2</li></ul>\n\nDRILLS:\n<ul><li>drill 1</li><li>drill 2</li></ul>";

        const result = await model.generateContent([
            prompt,
            { fileData: { fileUri: videoUrl, mimeType: "video/mp4" } }
        ]);

        const aiText = result.response.text();
        res.status(200).json({ text: aiText });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
}
