import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 300 }); // 5-minute TTL

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const cacheKey = 'workflow_runs';
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    console.log('Returning cached data');
    return res.status(200).json(cachedData);
  }

  try {
    const { Octokit } = await import('@octokit/rest');
    const fetch = (await import('node-fetch')).default;
    const AdmZip = (await import('adm-zip')).default;

    if (!process.env.GITHUB_TOKEN) {
      console.error('GITHUB_TOKEN is not set in environment variables');
      return res.status(500).json({ message: 'Server configuration error: GITHUB_TOKEN is missing' });
    }

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    // Check initial rate limit before any operations
    const initialRateLimit = await octokit.rateLimit.get();
    console.log('Initial rate limit before fetching runs:', {
      remaining: initialRateLimit.data.rate.remaining,
      limit: initialRateLimit.data.rate.limit,
      reset: new Date(initialRateLimit.data.rate.reset * 1000).toISOString()
    });

    const retryOnRateLimit = async (fn, retries = 3, delay = 1000) => {
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          return await fn();
        } catch (error) {
          if (error.status === 403 && error.message.includes('rate limit exceeded')) {
            if (attempt < retries - 1) {
              console.warn(`Rate limit exceeded. Retrying in ${delay}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              delay *= 2;
            } else {
              console.error('Rate limit exceeded after retries:', error.message);
              return { error: 'Rate limit exceeded', details: error.message };
            }
          } else {
            throw error;
          }
        }
      }
    };

    console.log('Fetching workflow runs...');
    const workflowRunsResponse = await retryOnRateLimit(() =>
      octokit.actions.listWorkflowRuns({
        owner: 'rsmedstad',
        repo: 'qa-automation-tool',
        workflow_id: 'run-qa.yml',
        per_page: 16, // Limit to reduce API load
      })
    );

    if (workflowRunsResponse?.error) {
      return res.status(429).json({
        message: 'GitHub API rate limit exceeded. Please try again later.',
        details: workflowRunsResponse.details
      });
    }

    const { data } = workflowRunsResponse;
    console.log(`Found ${data.workflow_runs.length} runs`);
    const runs = await Promise.all(data.workflow_runs.map(async run => {
      try {
        console.log(`Processing run ID: ${run.id}`);
        const artifactsResponse = await retryOnRateLimit(() =>
          octokit.actions.listWorkflowRunArtifacts({
            owner: 'rsmedstad',
            repo: 'qa-automation-tool',
            run_id: run.id,
          })
        );

        if (artifactsResponse?.error) {
          console.error(`Rate limit exceeded while fetching artifacts for run ${run.id}`);
          return null;
        }

        const artifacts = artifactsResponse.data.artifacts;
        const artifactCount = artifacts.length;
        const hasArtifacts = artifactCount > 0;
        console.log(`Run ${run.id} has ${artifactCount} artifacts`);

        const summaryArtifact = artifacts.find(artifact => artifact.name.startsWith('summary-json'));
        let detailedData = { passed: 0, failed: 0, na: 0, failed_urls: [], failed_tests: [], screenshot_paths: [], video_paths: [] };

        if (summaryArtifact) {
          console.log(`Downloading artifact ${summaryArtifact.id} for run ${run.id}`);
          const download = await retryOnRateLimit(() =>
            octokit.actions.downloadArtifact({
              owner: 'rsmedstad',
              repo: 'qa-automation-tool',
              artifact_id: summaryArtifact.id,
              archive_format: 'zip',
            })
          );

          if (download?.error) {
            console.error(`Rate limit exceeded while downloading artifact for run ${run.id}`);
            return null;
          }

          const zip = new AdmZip(Buffer.from(download.data));
          const zipEntries = zip.getEntries();
          const summaryEntry = zipEntries.find(entry => entry.entryName === 'summary.json');
          if (summaryEntry) {
            detailedData = JSON.parse(summaryEntry.getData().toString('utf8'));
            console.log(`Parsed summary.json for run ${run.id}:`, detailedData);
            detailedData.failed_urls = detailedData.failed_urls || [];
            detailedData.failed_tests = detailedData.failed_tests || {};
            detailedData.screenshot_paths = detailedData.screenshot_paths || [];
            detailedData.video_paths = detailedData.video_paths || [];
          }
        }

        return {
          crawlName: `Run #${run.run_number} - ${run.event === 'schedule' ? 'Scheduled' : 'Ad-Hoc'}`,
          date: run.created_at,
          initiator: detailedData.initiatedBy || run.actor.login,
          successCount: detailedData.successCount || 0,
          failureCount: detailedData.failureCount || 0,
          naCount: detailedData.naCount || 0,
          runId: run.id,
          event: run.event,
          hasArtifacts: hasArtifacts,
          artifactCount: artifactCount,
          failed_urls: detailedData.failedUrls || [],
          failed_tests: detailedData.testFailureSummary || {},
          screenshot_paths: detailedData.screenshot_paths || [],
          video_paths: detailedData.video_paths || []
        };
      } catch (runError) {
        console.error(`Error processing run ${run.id}:`, runError.message);
        return null;
      }
    }));

    const validRuns = runs.filter(run => run !== null);
    console.log(`Returning ${validRuns.length} valid runs`);
    cache.set(cacheKey, validRuns); // Cache the result before returning

    // Check rate limit after processing
    const finalRateLimit = await octokit.rateLimit.get();
    console.log('Rate limit after processing:', {
      remaining: finalRateLimit.data.rate.remaining,
      limit: finalRateLimit.data.rate.limit,
      reset: new Date(finalRateLimit.data.rate.reset * 1000).toISOString(),
      consumed: initialRateLimit.data.rate.remaining - finalRateLimit.data.rate.remaining
    });

    res.status(200).json(validRuns);
  } catch (error) {
    console.error('Error in /api/get-runs:', error.message, error.stack);
    if (error.status === 403 && error.message.includes('rate limit exceeded')) {
      return res.status(429).json({
        message: 'GitHub API rate limit exceeded. Please try again later.',
        details: error.message
      });
    }
    res.status(500).json({ message: 'Internal server error', details: error.message });
  }
}