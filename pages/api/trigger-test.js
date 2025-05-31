/*───────────────────────────────────────────────────────────────────────────────
  trigger-test.js
  ----------
  • Triggers an ad-hoc QA test by uploading the input.xlsx file to Vercel Blob
  • Dispatches the GitHub workflow with initiator, file URL, and captureVideo option
  • Validates passphrase before proceeding using QA_PASSPHRASE
  • Uses addRandomSuffix to avoid blob filename conflicts
───────────────────────────────────────────────────────────────────────────────*/

// Utility to select environment-aware storage config
function getBlobConfig() {
  const isPreview = process.env.VERCEL_ENV === 'preview';
  return {
    bucket: isPreview ? process.env.TEST_STORAGE_BUCKET : process.env.STORAGE_BUCKET,
    token: isPreview ? process.env.TEST_BLOB_READ_WRITE_TOKEN : process.env.BLOB_READ_WRITE_TOKEN,
    envLabel: isPreview ? 'PREVIEW' : 'PRODUCTION',
  };
}

async function uploadFileToStorage(fileBuffer, destPath = 'input.xlsx') {
  const { put } = await import('@vercel/blob');
  const { token, envLabel, bucket } = getBlobConfig();
  console.log(`[${envLabel}] Uploading to bucket: ${bucket}, using token: ${token ? 'SET' : 'NOT SET'}`);
  if (!token) throw new Error('Blob storage token is not set in the environment');
  const fullDestPath = bucket ? `${bucket}/${destPath}` : destPath;
  const blob = await put(fullDestPath, fileBuffer, {
    access: 'public',
    token,
    addRandomSuffix: true,
    allowOverwrite: true,
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
        file_url: fileUrl, // updated to match workflow input
        capture_video: captureVideo ? 'true' : 'false', // updated to match workflow input
        run_env: process.env.VERCEL_ENV || 'production', // renamed from env to run_env
      },
    });

    res.status(200).json({ message: 'Test initiated successfully' });
  } catch (error) {
    console.error('Error triggering test:', error);
    res.status(500).json({ message: 'Failed to trigger test' });
  }
}