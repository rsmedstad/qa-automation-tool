// Simple endpoint to validate the Gemini chat passphrase
export default function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ message: 'Method not allowed' });
    }
  
    const { passphrase } = req.body;
    if (passphrase === process.env.GEMINI_PASSPHRASE) {
      res.status(200).json({ valid: true });
    } else {
      res.status(401).json({ valid: false, message: 'Invalid passphrase' });
    }
  }
