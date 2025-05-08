const { Octokit } = require('@octokit/rest');
const fetch = require('node-fetch'); // Required for downloading artifacts
const AdmZip = require('adm-zip'); // For unzipping artifacts

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const { data } = await octokit.actions.listWorkflowRuns({
      owner: 'rsmedstad',
      repo: 'qa-automation-tool',
      workflow_id: 'run-qa.yml',
    });

    const runs = await Promise.all(data.workflow_runs.map(async run => {
      // Fetch artifacts for this run
      const artifactsResponse = await octokit.actions.listWorkflowRunArtifacts({
        owner: 'rsmedstad',
        repo: 'qa-automation-tool',
        run_id: run.id,
      });

      const artifacts = artifactsResponse.data.artifacts;
      const hasArtifacts = artifacts.length > 0; // Check if any artifacts exist

      // Find the summary.json artifact
      const summaryArtifact = artifacts.find(artifact => artifact.name === 'summary-json');
      let detailedData = { passed: 0, failed: 0, na: 0 };

      if (summaryArtifact) {
        // Download the artifact
        const download = await octokit.actions.downloadArtifact({
          owner: 'rsmedstad',
          repo: 'qa-automation-tool',
          artifact_id: summaryArtifact.id,
          archive_format: 'zip',
        });

        // Extract summary.json from the zip
        const zip = new AdmZip(Buffer.from(download.data));
        const zipEntries = zip.getEntries();
        const summaryEntry = zipEntries.find(entry => entry.entryName === 'summary.json');
        if (summaryEntry) {
          detailedData = JSON.parse(summaryEntry.getData().toString('utf8'));
        }
      }

      return {
        crawlName: `Run #${run.run_number} - ${run.event === 'schedule' ? 'Scheduled' : 'Ad-Hoc'}`, // Updated crawl name
        date: run.created_at,
        initiator: run.actor.login,
        successCount: detailedData.passed, // Use detailed counts
        failureCount: detailedData.failed,
        naCount: detailedData.na,
        runId: run.id,
        event: run.event, // For crawl type
        hasArtifacts: hasArtifacts, // Add flag for artifact existence
      };
    }));

    res.status(200).json(runs);
  } catch (error) {
    console.error('Error in /api/get-runs:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}