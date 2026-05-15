import { requireAuth } from '../../../lib/auth.js'
import { sendImessage } from '../../../lib/imessage-bridge.js'
import { pauseEnrollmentsForLead } from '../../../lib/sequences.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }
  if (!requireAuth(req, res)) return

  const { leadId, phone, message, mediaUrl } = req.body || {}
  if (!leadId || typeof leadId !== 'string') {
    return res.status(400).json({ error: 'leadId required' })
  }
  if (!phone || typeof phone !== 'string') {
    return res.status(400).json({ error: 'phone required' })
  }
  // Allow media-only replies (no text). At least one of message or mediaUrl
  // must be present.
  const hasMessage = typeof message === 'string' && message.length > 0
  const hasMedia = typeof mediaUrl === 'string' && mediaUrl.length > 0
  if (!hasMessage && !hasMedia) {
    return res.status(400).json({ error: 'message or mediaUrl required' })
  }

  try {
    const result = await sendImessage({
      phone,
      message: hasMessage ? message : '',
      mediaUrl: hasMedia ? mediaUrl : undefined,
      leadId
    })

    // Human reply = take over from any active sequences for this lead.
    // Best-effort; never fail the send because of this.
    let sequenceAction = null
    try {
      const r = await pauseEnrollmentsForLead(leadId, 'human reply via console')
      if (r.affected > 0) sequenceAction = `paused-${r.affected}`
    } catch (err) {
      console.error('console/reply: auto-pause failed', err)
    }

    return res.status(200).json({
      ok: true,
      phone: result.phone,
      messageHandle: result.send?.message_handle ?? null,
      logged: result.log.ok,
      logError: result.log.ok ? null : result.log.error,
      sequenceAction
    })
  } catch (err) {
    console.error('console/reply send failed', err)
    return res.status(502).json({ error: String(err?.message || err) })
  }
}
