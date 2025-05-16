const fetch = require('node-fetch');

const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

const CUTOFF_DAYS = 60;

async function listKeys(cursor) {
  const url = new URL(`${KV_REST_API_URL}/keys`);
  if (cursor) url.searchParams.set('cursor', cursor);
  url.searchParams.set('limit', '100');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` }
  });

  if (!res.ok) throw new Error(`Failed to list keys: ${res.status} ${res.statusText}`);
  return res.json();
}

async function getKeyValue(key) {
  const res = await fetch(`${KV_REST_API_URL}/string/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` }
  });
  if (!res.ok) throw new Error(`Failed to get key value for ${key}: ${res.status} ${res.statusText}`);
  return res.json();
}

async function deleteKey(key) {
  const res = await fetch(`${KV_REST_API_URL}/keys/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` }
  });
  if (!res.ok) throw new Error(`Failed to delete key ${key}: ${res.status} ${res.statusText}`);
  console.log(`Deleted key: ${key}`);
}

async function cleanup() {
  console.log('Starting Vercel KV cleanup...');
  const cutoffDate = new Date(Date.now() - CUTOFF_DAYS * 24 * 60 * 60 * 1000);
  let cursor = undefined;
  let totalDeleted = 0;

  do {
    const { keys, cursor: nextCursor } = await listKeys(cursor);

    for (const keyObj of keys) {
      const keyName = keyObj.name || keyObj;

      try {
        const valueResp = await getKeyValue(keyName);
        const jsonStr = valueResp.result;
        if (!jsonStr) {
          console.warn(`No value for key: ${keyName}`);
          continue;
        }

        let parsed;
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          console.warn(`Invalid JSON in key ${keyName}, skipping`);
          continue;
        }

        // Your KV JSON has a "date" field we will use for age check
        const keyDateStr = parsed.date;
        if (!keyDateStr) {
          console.warn(`No "date" field in JSON for key ${keyName}, skipping`);
          continue;
        }

        const keyDate = new Date(keyDateStr);
        if (keyDate < cutoffDate) {
          await deleteKey(keyName);
          totalDeleted++;
        }
      } catch (e) {
        console.error(`Error processing key ${keyName}:`, e.message);
      }
    }

    cursor = nextCursor;
  } while (cursor);

  console.log(`Vercel KV cleanup complete. Total keys deleted: ${totalDeleted}`);
}

cleanup().catch(err => {
  console.error('Cleanup error:', err);
  process.exit(1);
});
