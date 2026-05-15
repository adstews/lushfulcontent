import { requireAuth } from '../../../lib/auth.js'
import { sendImessage } from '../../../lib/imessage-bridge.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }
  if (!requireAuth(req, res)) return

  const { leadId, phone, message } = req.body || {}
  if (!leadId || typeof leadId !== 'string') {
    return res.status(400).json({ error: 'leadId required' })
  }
  if (!phone || typeof phone !== 'string') {
    return res.status(400).json({ error: 'phone required' })
  }
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message required' })
  }

  try {
    const result = await sendImessage({ phone, message, leadId })
    return res.status(200).json({
      ok: true,
      phone: result.phone,
      messageHandle: result.send?.message_handle ?? null,
      logged: result.log.ok,
      logError: result.log.ok ? null : result.log.error
    })
  } catch (err) {
    console.error('console/reply send failed', err)
    return res.status(502).json({ error: String(err?.message || err) })
  }
}
