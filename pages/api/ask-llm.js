// api/ask-llm.js
// Uses Google's Gemini API to answer questions and summarize crawl data

const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Handles POST requests to query the Gemini AI assistant.
 * @param {Object} req - The request object with the user's question and passphrase.
 * @param {Object} res - The response object to send back the AI's answer.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { question, passphrase } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  const storedPassphrase = process.env.GEMINI_PASSPHRASE;

  // Log for debugging
  console.log('Received passphrase:', passphrase);
  console.log('Stored passphrase:', storedPassphrase);

  // Validate passphrase
  if (!storedPassphrase || passphrase.trim() !== storedPassphrase.trim()) {
    console.log('Passphrase validation failed');
    return res.status(401).json({ message: 'Invalid passphrase' });
  }

  // Validate API key
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set');
    return res.status(500).json({ message: 'Server configuration error: API key missing' });
  }

  // Validate question
  if (!question || typeof question !== 'string' || question.trim() === '') {
    console.error('Invalid question:', question);
    return res.status(400).json({ message: 'Invalid or missing question' });
  }

  try {
    console.log('Querying Gemini with question:', question);
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const result = await model.generateContent(question);
    const response = await result.response;
    const text = await response.text();

    res.status(200).json({ answer: text.trim() });
  } catch (error) {
    console.error('Error querying Gemini:', error.message, error.stack);
    res.status(500).json({ message: 'Failed to get response from AI assistant', error: error.message });
  }
}