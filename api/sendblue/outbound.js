import { sendImessage } from '../../lib/imessage-bridge.js'

// Pulls a value from either the top-level body or a nested Close `event` object,
// trying snake_case and camelCase variants. Close's standard webhook envelope is
// `{ event: { lead_id, ... } }`; workflow HTTP steps can also POST a flat custom body.
function pick(body, ...keys) {
  for (const key of keys) {
    if (body?.[key] !== undefined && body[key] !== null && body[key] !== '') {
      return body[key]
    }
    if (body?.event?.[key] !== undefined && body.event[key] !== null && body.event[key] !== '') {
      return body.event[key]
    }
    if (body?.event?.data?.[key] !== undefined && body.event.data[key] !== null && body.event.data[key] !== '') {
      return body.event.data[key]
    }
  }
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }

  const body = req.body || {}
  const leadId = pick(body, 'lead_id', 'leadId')
  const phone = pick(body, 'phone', 'phone_number', 'number', 'to')
  const message = pick(body, 'message', 'content', 'text', 'body')
  const contactId = pick(body, 'contact_id', 'contactId')
  const sendStyle = pick(body, 'send_style', 'sendStyle')
  const mediaUrl = pick(body, 'media_url', 'mediaUrl')

  if (!phone || !message) {
    return res.status(400).json({
      error: 'missing fields',
      details: 'phone and message are required (top-level or in event.data)'
    })
  }

  try {
    const result = await sendImessage({
      phone,
      message,
      leadId: leadId ?? undefined,
      contactId: contactId ?? undefined,
      sendStyle: sendStyle ?? undefined,
      mediaUrl: mediaUrl ?? undefined
    })
    return res.status(200).json({
      ok: true,
      phone: result.phone,
      messageHandle: result.send?.message_handle ?? null,
      leadId: leadId ?? null,
      logged: result.log.ok,
      logError: result.log.ok ? null : result.log.error
    })
  } catch (err) {
    console.error('sendblue/outbound failed', err)
    return res.status(502).json({ error: String(err?.message || err) })
  }
}
