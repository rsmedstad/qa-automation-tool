// api/trigger-test.js
// Triggers an ad-hoc QA test by uploading the file to Vercel Blob and dispatching the GitHub workflow

/**
 * Uploads the input.xlsx file to Vercel Blob.
 * @param {Buffer} fileBuffer - The file buffer from the uploaded file.
 * @returns {string} The URL of the uploaded file.
 */
async function uploadFileToStorage(fileBuffer) {
  const { put } = await import('@vercel/blob');
  const blob = await put('input.xlsx', fileBuffer, {
    access: 'public',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return blob.url;
}

/**
 * Handles POST requests to trigger an ad-hoc QA test.
 * @param {Object} req - The request object with initiator, passphrase, and file.
 * @param {Object} res - The response object to send back status.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { initiator, passphrase, file } = req.body;

  // Verify passphrase
  if (passphrase !== process.env.PASSPHRASE) {
    return res.status(403).json({ message: 'Invalid passphrase' });
  }

  try {
    // Convert base64 file data to buffer
    const fileBuffer = Buffer.from(file, 'base64');

    // Upload file to Vercel Blob and get URL
    const fileUrl = await uploadFileToStorage(fileBuffer);

    // Dynamically import @octokit/rest
    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    // Trigger GitHub Actions workflow
    await octokit.actions.createWorkflowDispatch({
      owner: 'rsmedstad',
      repo: 'qa-automation-tool',
      workflow_id: 'run-qa.yml',
      ref: 'main',
      inputs: {
        initiator,
        file_url: fileUrl,
        passphrase: process.env.PASSPHRASE,
      },
    });

    res.status(200).json({ message: 'Test initiated successfully' });
  } catch (error) {
    console.error('Error triggering test:', error);
    res.status(500).json({ message: 'Failed to trigger test' });
  }
}