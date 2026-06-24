import { uploadStorage, downloadStorage } from '../server/proxy-storage.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'POST') {
    const result = await uploadStorage(req.body);
    return res.status(result.status).json(result.data);
  }

  if (req.method === 'GET') {
    const root = req.query?.root;
    const result = await downloadStorage(typeof root === 'string' ? root : root?.[0]);
    return res.status(result.status).json(result.data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}