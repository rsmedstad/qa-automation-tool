import { createClient } from '@supabase/supabase-js';

(async () => {
  const url = process.env.SUPABASE_TEST_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('❌ SUPABASE_URL or SERVICE_ROLE_KEY missing');
    process.exit(1);
  }

  const supabase = createClient(url, key);

  try {
    // Insert a heartbeat row so Supabase registers write activity
    const { error } = await supabase
      .from('keepalive')
      .insert({ created_at: new Date().toISOString() });
    if (error) {
      console.error('❌ Supabase keepalive insert failed:', JSON.stringify(error));
      process.exit(1);
    }
    console.log('✅ Inserted keepalive row');
  } catch (err) {
    console.error('❌ Unexpected error during keepalive insert:', err);
    process.exit(1);
  }

  try {
    // Optionally prune rows older than 60 days to avoid unbounded growth
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from('keepalive')
      .delete()
      .lt('created_at', cutoff);
    if (error) {
      console.warn('⚠️ Keepalive cleanup failed:', JSON.stringify(error));
    }
  } catch (err) {
    console.warn('⚠️ Keepalive cleanup error:', err);
  }
})();

