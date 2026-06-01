import { normalizePhone } from '../../lib/phone.js'
import { findLeadByPhone } from '../../lib/close.js'
import { logImessageActivity } from '../../lib/imessage-bridge.js'
import { pushToAll } from '../../lib/web-push.js'
import { suppressPhone } from '../../lib/opt-outs.js'
import { pauseEnrollmentsForLead, unenrollAllForLead, isStopKeyword } from '../../lib/sequences.js'
import { verifyHmacSignature, readRawBody } from '../../lib/hmac-signature.js'

export const config = { api: { bodyParser: false } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const raw = await readRawBody(req)
  const secret = process.env.BLOOIO_WEBHOOK_SIGNING_SECRET
  if (!verifyHmacSignature(raw, req.headers['x-blooio-signature'], secret)) {
    return res.status(401).json({ error: 'invalid signature' })
  }
  let body
  try { body = JSON.parse(raw) } catch { return res.status(400).json({ error: 'invalid json' }) }

  if (body.event !== 'message.received') {
    return res.status(200).json({ ok: true, skipped: body.event || 'unknown event' })
  }

  const phone = normalizePhone(body.sender)
  const message = body.text ?? ''
  const mediaUrl = Array.isArray(body.attachments) && body.attachments.length ? body.attachments[0] : null
  const handle = body.message_id ?? null
  if (!phone) return res.status(400).json({ error: 'invalid sender' })
  if (!message && !mediaUrl) return res.status(400).json({ error: 'empty message' })

  const stop = isStopKeyword(message)

  let lead = null
  try { lead = await findLeadByPhone(phone) }
  catch (err) { return res.status(502).json({ error: `Close lookup failed: ${err.message}` }) }

  if (stop) {
    try { await suppressPhone({ phone, leadId: lead?.closeLeadId ?? null, reason: 'stop-keyword' }) }
    catch (err) { console.error('imessage/inbound suppressPhone failed', err) }
    if (lead) { try { await unenrollAllForLead(lead.closeLeadId, 'stop keyword') } catch (err) { console.error(err) } }
  }

  if (!lead) return res.status(200).json({ ok: true, matched: false, phone, suppressed: stop })

  const logResult = await logImessageActivity({
    leadId: lead.closeLeadId, leadName: lead.displayName, contactId: lead.contactId,
    direction: 'inbound', message: message || '', phone, mediaUrl, sendblueHandle: handle
  })

  let sequenceAction = null
  try {
    if (stop) sequenceAction = 'unenrolled-all-stop'
    else { const r = await pauseEnrollmentsForLead(lead.closeLeadId, 'inbound reply'); if (r.affected > 0) sequenceAction = `paused-${r.affected}` }
  } catch (err) { console.error('imessage/inbound sequence side-effect failed', err) }

  let pushed = 0
  try { pushed = (await pushToAll({ title: lead.displayName || phone, body: message || (mediaUrl ? '📎 Attachment' : ''), tag: `lead:${lead.closeLeadId}`, data: { leadId: lead.closeLeadId, phone, url: '/imessage' } })).sent || 0 }
  catch (err) { console.error('imessage/inbound push failed', err) }

  return res.status(200).json({ ok: true, matched: true, phone, leadId: lead.closeLeadId, logged: logResult.ok, pushed, sequenceAction })
}
