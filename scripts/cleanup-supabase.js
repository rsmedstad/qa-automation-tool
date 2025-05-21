const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function cleanup() {
  const cutoffDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  console.log(`Cutoff date: ${cutoffDate}`);

  try {
    // Clean up crawl_progress (started_at)
    console.log('Deleting old crawl_progress records (started_at)...');
    const { data: crawlData1, error: crawlError1 } = await supabase
      .from('crawl_progress')
      .delete()
      .lt('started_at', cutoffDate);
    if (crawlError1) throw new Error(`crawl_progress (started_at): ${crawlError1.message}`);
    console.log(`Deleted ${crawlData1?.length || 0} old crawl_progress records (started_at)`);

    // Clean up crawl_progress (created_at)
    console.log('Deleting old crawl_progress records (created_at)...');
    const { data: crawlData2, error: crawlError2 } = await supabase
      .from('crawl_progress')
      .delete()
      .lt('created_at', cutoffDate);
    if (crawlError2) throw new Error(`crawl_progress (created_at): ${crawlError2.message}`);
    console.log(`Deleted ${crawlData2?.length || 0} old crawl_progress records (created_at)`);

    // Clean up test_results
    console.log('Deleting old test_results records...');
    const { data: resultsData, error: resultsError } = await supabase
      .from('test_results')
      .delete()
      .lt('timestamp', cutoffDate);
    if (resultsError) throw new Error(`test_results: ${resultsError.message}`);
    console.log(`Deleted ${resultsData?.length || 0} old test_results records`);

    // Clean up test_runs
    console.log('Deleting old test_runs records...');
    const { data: runsData, error: runsError } = await supabase
      .from('test_runs')
      .delete()
      .lt('created_at', cutoffDate);
    if (runsError) throw new Error(`test_runs: ${runsError.message}`);
    console.log(`Deleted ${runsData?.length || 0} old test_runs records`);

    console.log('Supabase cleanup complete.');
  } catch (err) {
    console.error('Error during Supabase cleanup:', err.message);
    process.exit(1); // Exit with failure code to flag the issue in your workflow
  }
}

cleanup();