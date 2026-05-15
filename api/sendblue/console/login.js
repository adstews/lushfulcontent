import { checkPassword, makeSessionCookie, clearSessionCookie } from '../../../lib/auth.js'

export default async function handler(req, res) {
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearSessionCookie())
    return res.status(200).json({ ok: true })
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }
  const submitted = req.body?.password
  if (typeof submitted !== 'string' || submitted.length === 0) {
    return res.status(400).json({ error: 'password required' })
  }
  let ok
  try {
    ok = checkPassword(submitted)
  } catch (err) {
    console.error('console/login config error', err)
    return res.status(500).json({ error: 'server not configured' })
  }
  if (!ok) {
    return res.status(401).json({ error: 'invalid password' })
  }
  res.setHeader('Set-Cookie', makeSessionCookie())
  return res.status(200).json({ ok: true })
}
