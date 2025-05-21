import fetch from 'node-fetch';

const KV_REST_API_URL = process.env.KV_REST_API_URL?.replace(/\/+$/, '');
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;
const CUTOFF_DAYS = 60;

async function listKeys(cursor = '') {
  const url = new URL(`${KV_REST_API_URL}/list`);
  if (cursor) url.searchParams.set('cursor', cursor);
  url.searchParams.set('limit', '100');

  console.log(`[DEBUG] Listing keys from: ${url.toString()}`);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to list keys: ${res.status} ${res.statusText} - ${body}`);
  }

  // Vercel KV /list response shape:
  // { result: [ { name: 'key1', metadata: {...} }, … ], cursor: 'next-cursor' }
  const { result, cursor: nextCursor } = await res.json();
  const keys = result.map(item => item.name);
  return { keys, cursor: nextCursor };
}

async function getKeyValue(key) {
  const url = `${KV_REST_API_URL}/get/${encodeURIComponent(key)}`;
  console.log(`[DEBUG] Fetching key value: ${url}`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to get key value for ${key}: ${res.status} ${res.statusText} - ${body}`);
  }

  return res.json(); // { result: "…string…" }
}

async function batchDeleteKeys(keys) {
  const url = `${KV_REST_API_URL}/del`;
  console.log(`[DEBUG] Batch deleting ${keys.length} keys`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(keys),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to batch delete keys: ${res.status} ${res.statusText} - ${body}`);
  }

  const { result } = await res.json();
  console.log(`Deleted ${result.length} keys.`);
  return result;
}

async function cleanup() {
  console.log('Starting Vercel KV cleanup…');
  const cutoff = Date.now() - CUTOFF_DAYS * 24 * 60 * 60 * 1000;
  let cursor = '';
  let totalDeleted = 0;

  try {
    do {
      const { keys, cursor: next } = await listKeys(cursor);
      const toDelete = [];

      for (const name of keys) {
        try {
          const { result: jsonStr } = await getKeyValue(name);
          if (!jsonStr) continue;

          let obj;
          try { obj = JSON.parse(jsonStr); }
          catch { continue; }

          if (obj.date && new Date(obj.date).getTime() < cutoff) {
            toDelete.push(name);
          }
        } catch (e) {
          console.error(`Error reading key ${name}:`, e.message);
        }
      }

      if (toDelete.length) {
        const deleted = await batchDeleteKeys(toDelete);
        totalDeleted += deleted.length;
      }

      cursor = next;
    } while (cursor);

    console.log(`Cleanup complete. Total keys deleted: ${totalDeleted}`);
  } catch (e) {
    console.error('Cleanup error:', e.message);
    process.exit(1);
  }
}

cleanup();
