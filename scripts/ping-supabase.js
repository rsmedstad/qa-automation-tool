import { createClient } from '@supabase/supabase-js';

(async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('❌ SUPABASE_URL or SERVICE_ROLE_KEY missing');
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    localStorage: null,
    detectSessionInUrl: false
  });

  try {
    // Execute a trivial SQL call so the database registers activity
    const { data, error } = await supabase.rpc('select_one');
    if (error) throw error;
    console.log('✅ Supabase SQL ping result:', data);
    process.exit(0);
  } catch (err) {
    console.error('❌ Supabase ping failed:', err.message || err);
    process.exit(1);
  }
})();
