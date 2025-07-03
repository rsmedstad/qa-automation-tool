import { createClient } from '@supabase/supabase-js';

(async () => {
  const url = process.env.SUPABASE_TEST_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('❌ SUPABASE_URL or SERVICE_ROLE_KEY missing');
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    localStorage: null,
    detectSessionInUrl: false
  });

  try {
    // Insert a heartbeat row so Supabase registers write activity
    const { error } = await supabase
      .from('keepalive')
      .insert({ created_at: new Date().toISOString() });
    if (error) throw error;
    console.log('✅ Inserted keepalive row');
  } catch (err) {
    console.error('❌ Supabase keepalive insert failed:', err.message || err);
    process.exit(1);
  }

  try {
    // Optionally prune rows older than 60 days to avoid unbounded growth
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from('keepalive')
      .delete()
      .lt('created_at', cutoff);
  } catch (err) {
    console.warn('⚠️ Keepalive cleanup failed:', err.message || err);
  }
})();
