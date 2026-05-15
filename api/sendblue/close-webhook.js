import { findSequencesForStatusTrigger, enrollLead } from '../../lib/sequences.js'

// Close webhook receiver for lead.updated events. We detect status transitions
// (data.status_id != previous_data.status_id) and auto-enroll the lead into
// any active sequence whose trigger_status_id matches the new status.
//
// Close's webhook subscription system has no signature mechanism we can rely
// on, so we accept an optional shared secret via ?secret= query param. The
// signature_key Close returns when you create a subscription is used to verify
// the payload signature if/when Close starts signing — until then, the URL
// secret is our gate.
function verifySecret(req) {
  const expected = process.env.CLOSE_WEBHOOK_SECRET
  if (!expected) return true // gate disabled
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
  const event = body.event || body
  const action = event.action || event.event
  const objectType = event.object_type || event.objectType
  if (objectType !== 'lead' || (action !== 'updated' && action !== 'created')) {
    return res.status(200).json({ ok: true, skipped: 'not a lead update' })
  }

  const data = event.data || event
  const previousData = event.previous_data || event.previousData || {}
  const leadId = data.id || event.lead_id
  const newStatusId = data.status_id
  const oldStatusId = previousData.status_id
  if (!leadId || !newStatusId) {
    return res.status(200).json({ ok: true, skipped: 'missing leadId or status_id' })
  }
  // For "created" events, treat the new status as a transition; for "updated"
  // only treat as a transition if the status actually changed.
  if (action === 'updated' && newStatusId === oldStatusId) {
    return res.status(200).json({ ok: true, skipped: 'no status change' })
  }

  let sequences
  try {
    sequences = await findSequencesForStatusTrigger(newStatusId)
  } catch (err) {
    console.error('close-webhook: findSequencesForStatusTrigger failed', err)
    return res.status(500).json({ error: String(err?.message || err) })
  }
  if (sequences.length === 0) {
    return res.status(200).json({ ok: true, statusId: newStatusId, matched: 0 })
  }

  // Pull a phone for the enrollment from the event payload. Close sends
  // contacts inline on updated events.
  const contact = (data.contacts || [])[0]
  const phone = contact?.phones?.[0]?.phone || null
  const contactId = contact?.id || null

  const enrolled = []
  for (const seq of sequences) {
    try {
      const e = await enrollLead({ sequenceId: seq.id, leadId, phone, contactId, source: 'status-trigger' })
      enrolled.push({ sequenceId: seq.id, sequenceName: seq.name, enrollmentId: e.id, alreadyEnrolled: !!e.alreadyEnrolled })
    } catch (err) {
      console.error(`close-webhook: enroll failed for ${seq.id}`, err)
      enrolled.push({ sequenceId: seq.id, error: String(err?.message || err) })
    }
  }
  return res.status(200).json({ ok: true, leadId, statusId: newStatusId, enrolled })
}
