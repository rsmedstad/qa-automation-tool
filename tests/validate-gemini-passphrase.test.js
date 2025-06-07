// Integration tests for the Gemini passphrase validation API route
import express from 'express';
import request from 'supertest';
import handler from '../pages/api/validate-gemini-passphrase.js';

const app = express();
app.use(express.json());
app.post('/api/validate-gemini-passphrase', (req, res) => handler(req, res));

describe('validate-gemini-passphrase', () => {
  const VALID = 'test-pass';
  beforeAll(() => {
    process.env.GEMINI_PASSPHRASE = VALID;
  });

  test('returns 200 for valid passphrase', async () => {
    const res = await request(app)
      .post('/api/validate-gemini-passphrase')
      .send({ passphrase: VALID });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true });
  });

  test('returns 401 for invalid passphrase', async () => {
    const res = await request(app)
      .post('/api/validate-gemini-passphrase')
      .send({ passphrase: 'bad' });
    expect(res.status).toBe(401);
    expect(res.body.valid).toBe(false);
  });
});
