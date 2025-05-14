import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabase
      .from('test_definitions')
      .select('test_id, title, description, test_method, screamingfrog_feature, screamingfrog_method, category');

    if (error) {
      console.error('Supabase error:', error);
      throw new Error('Error fetching data from Supabase');
    }

    console.log('Raw Supabase data:', data);

    // Set both testDefinitions and sfTests to the full list of tests
    const testDefinitions = data;
    const sfTests = data;

    console.log('testDefinitions:', testDefinitions);
    console.log('sfTests:', sfTests);

    // Prevent caching issues
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.status(200).json({ testDefinitions: testDefinitions || [], sfTests: sfTests || [] });
  } catch (error) {
    console.error('Error in /api/get-test-definitions:', error.message);
    res.status(500).json({ message: 'Internal server error', details: error.message });
  }
}