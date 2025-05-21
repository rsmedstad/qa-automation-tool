const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function cleanup() {
  const cutoffDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  console.log('Deleting old crawl_progress records...');
  try {
    await supabase
      .from('crawl_progress')
      .delete()
      .lt('started_at', cutoffDate);
  } catch (error) {
    console.error('Error deleting old crawl_progress records (by started_at):', error);
  }

  try {
    await supabase
      .from('crawl_progress')
      .delete()
      .lt('created_at', cutoffDate);
  } catch (error) {
    console.error('Error deleting old crawl_progress records (by created_at):', error);
  }

  console.log('Deleting old test_results records...');
  try {
    await supabase
      .from('test_results')
      .delete()
      .lt('timestamp', cutoffDate);
  } catch (error) {
    console.error('Error deleting old test_results records:', error);
  }

  console.log('Deleting old test_runs records...');
  try {
    await supabase
      .from('test_runs')
      .delete()
      .lt('created_at', cutoffDate);
  } catch (error) {
    console.error('Error deleting old test_runs records:', error);
  }

  console.log('Supabase cleanup complete.');
}

cleanup().catch(console.error);
