const { Octokit } = require('@octokit/rest');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    console.log('Fetching workflow runs...');
    const { data } = await octokit.actions.listWorkflowRuns({
      owner: 'rsmedstad',
      repo: 'qa-automation-tool',
      workflow_id: 'run-qa.yml',
    });

    console.log(`Found ${data.workflow_runs.length} runs`);
    const runs = await Promise.all(data.workflow_runs.map(async run => {
      try {
        console.log(`Processing run ID: ${run.id}`);
        const artifactsResponse = await octokit.actions.listWorkflowRunArtifacts({
          owner: 'rsmedstad',
          repo: 'qa-automation-tool',
          run_id: run.id,
        });

        const artifacts = artifactsResponse.data.artifacts;
        const hasArtifacts = artifacts.length > 0;
        console.log(`Run ${run.id} has ${artifacts.length} artifacts`);

        const summaryArtifact = artifacts.find(artifact => artifact.name === 'summary-json');
        let detailedData = { passed: 0, failed: 0, na: 0 };

        if (summaryArtifact) {
          console.log(`Downloading artifact ${summaryArtifact.id} for run ${run.id}`);
          const download = await octokit.actions.downloadArtifact({
            owner: 'rsmedstad',
            repo: 'qa-automation-tool',
            artifact_id: summaryArtifact.id,
            archive_format: 'zip',
          });

          const zip = new AdmZip(Buffer.from(download.data));
          const zipEntries = zip.getEntries();
          const summaryEntry = zipEntries.find(entry => entry.entryName === 'summary.json');
          if (summaryEntry) {
            detailedData = JSON.parse(summaryEntry.getData().toString('utf8'));
            console.log(`Parsed summary.json for run ${run.id}:`, detailedData);
          } else {
            console.log(`No summary.json found in artifact for run ${run.id}`);
          }
        } else {
          console.log(`No summary-json artifact for run ${run.id}`);
        }

        return {
          crawlName: `Run #${run.run_number} - ${run.event === 'schedule' ? 'Scheduled' : 'Ad-Hoc'}`,
          date: run.created_at,
          initiator: run.actor.login,
          successCount: detailedData.passed,
          failureCount: detailedData.failed,
          naCount: detailedData.na,
          runId: run.id,
          event: run.event,
          hasArtifacts: hasArtifacts,
        };
      } catch (runError) {
        console.error(`Error processing run ${run.id}:`, runError.message);
        return null; // Skip this run but continue processing others
      }
    }));

    const validRuns = runs.filter(run => run !== null);
    console.log(`Returning ${validRuns.length} valid runs`);
    res.status(200).json(validRuns);
  } catch (error) {
    console.error('Error in /api/get-runs:', error.message, error.stack);
    res.status(500).json({ message: 'Internal server error', details: error.message });
  }
}