import { normalizePhone } from '../../lib/sendblue.js'
import { findLeadByPhone } from '../../lib/close.js'
import { logImessageActivity } from '../../lib/imessage-bridge.js'
import { pushToAll } from '../../lib/web-push.js'
import { getSupabase } from '../../lib/supabase.js'
import { pauseEnrollmentsForLead, unenrollAllForLead, isStopKeyword } from '../../lib/sequences.js'

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

const REACTION_KEYS = new Set(['love', 'like', 'dislike', 'laugh', 'emphasize', 'question'])

async function handleReactionEvent({ body, phone }) {
  // SendBlue reaction inbound payload includes a reaction field plus the
  // original message handle. Persist into Supabase; tying back to a Close
  // lead is best-effort — we don't require a match.
  const reaction = body.reaction ?? body.tap_back ?? body.action ?? null
  const messageHandle = body.message_handle ?? body.handle ?? body.target_message_handle ?? null
  const removed = !!body.is_removed || (typeof reaction === 'string' && reaction.startsWith('-'))
  const cleanReaction = removed && reaction?.startsWith('-') ? reaction.slice(1) : reaction
  if (!reaction || !messageHandle) {
    return { ok: true, kind: 'reaction', skipped: 'missing reaction or message_handle' }
  }
  if (!REACTION_KEYS.has(cleanReaction)) {
    return { ok: true, kind: 'reaction', skipped: `unknown reaction: ${cleanReaction}` }
  }

  let lead = null
  try { lead = await findLeadByPhone(phone) } catch {}
  try {
    const sb = getSupabase()
    await sb.from('imessage_console_reactions').insert({
      message_handle: messageHandle,
      lead_id: lead?.closeLeadId || null,
      direction: 'inbound',
      reaction: cleanReaction,
      removed
    })
  } catch (err) {
    console.error('inbound reaction persist failed', err)
  }

  let pushSent = 0
  if (lead && !removed) {
    try {
      const r = await pushToAll({
        title: lead.displayName || phone,
        body: `Reacted ${cleanReaction} to your message`,
        tag: `lead:${lead.closeLeadId}:reaction`,
        data: { leadId: lead.closeLeadId, phone, url: '/imessage' }
      })
      pushSent = r?.sent || 0
    } catch {}
  }

  return { ok: true, kind: 'reaction', reaction: cleanReaction, removed, leadId: lead?.closeLeadId || null, pushed: pushSent }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }
  if (!verifySecret(req)) {
    return res.status(401).json({ error: 'invalid webhook secret' })
  }

  const body = req.body || {}

  const rawFrom =
    body.from_number ?? body.number ?? body.phone ?? body.from ?? null
  const phone = normalizePhone(rawFrom)
  if (!phone) {
    return res.status(400).json({ error: 'invalid phone' })
  }

  // Branch by event type. SendBlue's payload uses `type` (or sometimes
  // `event_type`) — known values include `message` and `reaction`.
  const eventType = body.type ?? body.event_type ?? null
  const looksLikeReaction = eventType === 'reaction'
    || body.reaction != null || body.tap_back != null

  if (looksLikeReaction) {
    return res.status(200).json(await handleReactionEvent({ body, phone }))
  }

  // Otherwise treat as a regular message event.
  const message =
    body.content ?? body.message ?? body.text ?? body.body ?? null
  const mediaUrl = body.media_url ?? body.mediaUrl ?? null
  const sendblueHandle = body.message_handle ?? body.handle ?? null

  // Allow media-only messages (no text content) — iMessage supports them.
  if (!message && !mediaUrl) {
    return res.status(400).json({
      error: 'missing fields',
      details: 'content/message or media_url is required'
    })
  }

  let lead = null
  try {
    lead = await findLeadByPhone(phone)
  } catch (err) {
    console.error('sendblue/inbound: Close lookup failed', err)
    return res.status(502).json({ error: `Close lookup failed: ${err.message}` })
  }

  if (!lead) {
    return res.status(200).json({
      ok: true,
      matched: false,
      phone,
      note: 'no Close lead found for this phone — message was received but not logged'
    })
  }

  const logResult = await logImessageActivity({
    leadId: lead.closeLeadId,
    leadName: lead.displayName,
    contactId: lead.contactId,
    direction: 'inbound',
    message: message || '',
    phone,
    mediaUrl,
    sendblueHandle
  })

  // Sequence side effects: STOP keyword hard-unenrolls; any other reply
  // pauses (or unenrolls — depends on each sequence's on_reply_behavior).
  let sequenceAction = null
  try {
    if (isStopKeyword(message)) {
      await unenrollAllForLead(lead.closeLeadId, 'stop keyword')
      sequenceAction = 'unenrolled-all-stop'
    } else {
      const r = await pauseEnrollmentsForLead(lead.closeLeadId, 'inbound reply')
      if (r.affected > 0) sequenceAction = `paused-${r.affected}`
    }
  } catch (err) {
    console.error('inbound: sequence auto-pause failed', err)
  }

  let pushResult = { ok: false, sent: 0 }
  try {
    pushResult = await pushToAll({
      title: lead.displayName || phone,
      body: message || (mediaUrl ? '📎 Attachment' : ''),
      tag: `lead:${lead.closeLeadId}`,
      data: { leadId: lead.closeLeadId, phone, url: '/imessage' }
    })
  } catch (err) {
    console.error('inbound push fan-out failed', err)
  }

  return res.status(200).json({
    ok: true,
    matched: true,
    phone,
    leadId: lead.closeLeadId,
    logged: logResult.ok,
    logError: logResult.ok ? null : logResult.error,
    pushed: pushResult.sent || 0,
    sequenceAction
  })
}
