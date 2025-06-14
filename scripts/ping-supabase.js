import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(url, key);

try {
  const { error } = await supabase.from('test_runs').select('id').limit(1);
  if (error) {
    console.error('Ping failed:', error.message);
    process.exit(1);
  }
  console.log('Supabase ping successful');
} catch (err) {
  console.error('Ping failed:', err.message);
  process.exit(1);
}
