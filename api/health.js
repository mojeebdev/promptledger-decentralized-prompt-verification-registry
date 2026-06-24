import { getHealth } from '../server/proxy-compute.js';
import { getStorageHealth } from '../server/proxy-storage.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(200).json({ ...getHealth(), storage: getStorageHealth() });
}