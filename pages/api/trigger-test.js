/*───────────────────────────────────────────────────────────────────────────────
  trigger-test.js
  ----------
  • Triggers an ad-hoc QA test by uploading the input.xlsx file to Vercel Blob
  • Dispatches the GitHub workflow with initiator, file URL, and captureVideo option
  • Validates passphrase before proceeding using QA_PASSPHRASE
  • Uses addRandomSuffix to avoid blob filename conflicts
───────────────────────────────────────────────────────────────────────────────*/

async function uploadFileToStorage(fileBuffer) {
  const { put } = await import('@vercel/blob');
  const blob = await put('input.xlsx', fileBuffer, {
    access: 'public',
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: true,
  });
  return blob.url;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { initiator, passphrase, file, captureVideo } = req.body;

  if (passphrase !== process.env.QA_PASSPHRASE) {
    return res.status(403).json({ message: 'Invalid passphrase' });
  }

  try {
    let fileUrl = '';
    if (file) {
      const fileBuffer = Buffer.from(file, 'base64');
      fileUrl = await uploadFileToStorage(fileBuffer);
    }

    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    await octokit.actions.createWorkflowDispatch({
      owner: 'rsmedstad',
      repo: 'qa-automation-tool',
      workflow_id: 'run-qa.yml',
      ref: 'main',
      inputs: {
        initiator,
        file_url: fileUrl,
        passphrase: process.env.QA_PASSPHRASE,
        capture_video: String(captureVideo === true)
      },
    });

    res.status(200).json({ message: 'Test initiated successfully' });
  } catch (error) {
    console.error('Error triggering test:', error);
    res.status(500).json({ message: 'Failed to trigger test' });
  }
}