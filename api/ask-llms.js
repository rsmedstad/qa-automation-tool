// api/ask-llm.js
// Uses Google's Gemini API to answer questions and summarize crawl data

const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Handles POST requests to query the Gemini AI assistant.
 * @param {Object} req - The request object with the user's question.
 * @param {Object} res - The response object to send back the AI's answer.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { question } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent(question);
    const response = await result.response;
    const text = await response.text();

    res.status(200).json({ answer: text.trim() });
  } catch (error) {
    console.error('Error querying Gemini:', error);
    res.status(500).json({ message: 'Failed to get response from AI assistant' });
  }
}