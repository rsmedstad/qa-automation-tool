// pages/api/trigger-crawl.js
import ExcelJS from 'exceljs';
import { put } from '@vercel/blob';
import { Octokit } from '@octokit/rest';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { data, initiator, passphrase } = req.body;

  if (passphrase !== process.env.QA_PASSPHRASE) {
    return res.status(403).json({ message: 'Invalid passphrase' });
  }

  if (!Array.isArray(data) || !initiator) {
    return res.status(400).json({ message: 'Invalid data or missing initiator' });
  }

  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('URLs');
    worksheet.columns = [
      { header: 'URL', key: 'url' },
      { header: 'Test IDs', key: 'testIds' },
      { header: 'Region', key: 'region' },
    ];
    data.forEach(row => {
      worksheet.addRow({
        url: row.url,
        testIds: row.testIds,
        region: row.region || ''
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();

    const blob = await put('input.xlsx', buffer, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: true,
      allowOverwrite: true, // Added to enable overwriting
    });

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const newRunId = `run-${uuidv4()}`;
    const response = await octokit.actions.createWorkflowDispatch({
      owner: 'rsmedstad',
      repo: 'qa-automation-tool',
      workflow_id: 'run-qa.yml',
      ref: 'main',
      inputs: {
        initiator,
        file_url: blob.url,
        passphrase: process.env.QA_PASSPHRASE,
        capture_video: 'false'
      },
    });

    res.status(200).json({ message: 'Crawl initiated', runId: newRunId });
  } catch (error) {
    console.error('Error triggering crawl:', error);
    res.status(500).json({ message: 'Failed to trigger crawl', error: error.message });
  }
}