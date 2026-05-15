import { normalizePhone } from '../../lib/sendblue.js'
import { findLeadByPhone } from '../../lib/close.js'
import { logImessageActivity } from '../../lib/imessage-bridge.js'

// SendBlue posts incoming messages to this URL. There's no HMAC signature,
// so we accept a shared secret via either the `X-Webhook-Secret` header or
// a `?secret=` query string param when SENDBLUE_WEBHOOK_SECRET is configured.
function verifySecret(req) {
  const expected = process.env.SENDBLUE_WEBHOOK_SECRET
  if (!expected) return true
  const header = req.headers?.['x-webhook-secret']
  if (header && header === expected) return true
  try {
    const url = new URL(req.url, 'http://localhost')
    if (url.searchParams.get('secret') === expected) return true
  } catch {}
  return false
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }
  if (!verifySecret(req)) {
    return res.status(401).json({ error: 'invalid webhook secret' })
  }

  const body = req.body || {}
  // SendBlue inbound payload keys vary slightly across event types; accept
  // common variants for the sender's number and message content.
  const rawFrom =
    body.from_number ?? body.number ?? body.phone ?? body.from ?? null
  const message =
    body.content ?? body.message ?? body.text ?? body.body ?? null
  const mediaUrl = body.media_url ?? body.mediaUrl ?? null
  const sendblueHandle = body.message_handle ?? body.handle ?? null

  if (!rawFrom || !message) {
    return res.status(400).json({
      error: 'missing fields',
      details: 'from_number/number and content/message are required'
    })
  }

  const phone = normalizePhone(rawFrom)
  if (!phone) {
    return res.status(400).json({ error: 'invalid phone' })
  }

  let lead = null
  try {
    lead = await findLeadByPhone(phone)
  } catch (err) {
    console.error('sendblue/inbound: Close lookup failed', err)
    return res.status(502).json({ error: `Close lookup failed: ${err.message}` })
  }

  if (!lead) {
    // Acknowledge so SendBlue stops retrying, but report the no-match.
    return res.status(200).json({
      ok: true,
      matched: false,
      phone,
      note: 'no Close lead found for this phone — message was received but not logged'
    })
  }

  const logResult = await logImessageActivity({
    leadId: lead.closeLeadId,
    contactId: lead.contactId,
    direction: 'inbound',
    message,
    phone,
    mediaUrl,
    sendblueHandle
  })

  return res.status(200).json({
    ok: true,
    matched: true,
    phone,
    leadId: lead.closeLeadId,
    logged: logResult.ok,
    logError: logResult.ok ? null : logResult.error
  })
}
