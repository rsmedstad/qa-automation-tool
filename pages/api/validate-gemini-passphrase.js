// Simple endpoint to validate the Gemini chat passphrase
import { timingSafeEqual } from 'crypto';

export default function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ message: 'Method not allowed' });
    }

    const { passphrase } = req.body;
    const expected = process.env.GEMINI_PASSPHRASE || '';
    if (passphrase && passphrase.length === expected.length && timingSafeEqual(Buffer.from(passphrase), Buffer.from(expected))) {
      res.status(200).json({ valid: true });
    } else {
      res.status(401).json({ valid: false, message: 'Invalid passphrase' });
    }
  }
