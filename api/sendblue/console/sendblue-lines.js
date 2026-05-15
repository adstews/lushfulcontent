import { requireAuth } from '../../../lib/auth.js'

// Auth-gated proxy listing the SendBlue lines (phone numbers) assigned to
// the workspace. We need at least one to set SENDBLUE_FROM_NUMBER so the
// /send-message endpoint knows which line to send from.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' })
  }
  if (!requireAuth(req, res)) return

  const keyId = process.env.SENDBLUE_API_KEY
  const secret = process.env.SENDBLUE_API_SECRET
  if (!keyId || !secret) {
    return res.status(500).json({ error: 'SENDBLUE_API_KEY or SENDBLUE_API_SECRET not set' })
  }

  try {
    const r = await fetch('https://api.sendblue.co/api/lines', {
      method: 'GET',
      headers: {
        'sb-api-key-id': keyId,
        'sb-api-secret-key': secret
      }
    })
    const text = await r.text()
    let payload
    try { payload = JSON.parse(text) } catch { payload = { raw: text } }
    return res.status(r.ok ? 200 : 502).json({ status: r.status, payload })
  } catch (err) {
    console.error('console/sendblue-lines failed', err)
    return res.status(502).json({ error: String(err?.message || err) })
  }
}
