import { sendImessage } from '../../lib/imessage-bridge.js'
import { getLead } from '../../lib/close.js'
import {
  findDueSends, tryAdvanceEnrollment, recordSend, markCompleted, renderTemplate, unenrollAllForLead
} from '../../lib/sequences.js'
import {
  findDueScheduledMessages, claimScheduledMessage, markScheduledSent, markScheduledFailed
} from '../../lib/scheduled-messages.js'
import { isNewConversation, tryReserveNewConversation } from '../../lib/new-convo-throttle.js'

const NEW_CONVO_CAP = parseInt(process.env.IMESSAGE_NEW_CONVO_DAILY_CAP || '14', 10)

// Vercel Cron hits this every 5 minutes. Vercel Cron requests carry an
// Authorization header matching the project's CRON_SECRET env var; on Vercel
// Pro/Hobby plans this is also enforced via x-vercel-cron header. We belt-
// and-suspenders verify both.
function verifyCron(req) {
  const auth = req.headers?.authorization
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (process.env.CRON_SECRET && auth === expected) return true
  if (req.headers?.['x-vercel-cron'] === '1') return true
  return false
}

export default async function handler(req, res) {
  if (!verifyCron(req)) {
    return res.status(401).json({ error: 'unauthorized cron call' })
  }

  const now = new Date()

  let due = []
  try {
    due = await findDueSends({ now, limit: 50 })
  } catch (err) {
    console.error('sequence-tick: findDueSends failed', err)
    return res.status(500).json({ error: String(err?.message || err) })
  }

  const results = await Promise.allSettled(due.map(item => fireOne(item)))
  const fired = results.filter(r => r.status === 'fulfilled' && r.value.fired).length
  const failed = results.filter(r => r.status === 'fulfilled' && r.value.error).length
  const completed = results.filter(r => r.status === 'fulfilled' && r.value.completed).length
  const deferred = results.filter(r => r.status === 'fulfilled' && r.value.deferred).length

  const reminders = await drainScheduledMessages(now)

  return res.status(200).json({ ok: true, due: due.length, fired, failed, completed, deferred, reminders })
}

async function drainScheduledMessages(now) {
  let dueMsgs = []
  try {
    dueMsgs = await findDueScheduledMessages({ now, limit: 50 })
  } catch (err) {
    console.error('sequence-tick: findDueScheduledMessages failed', err)
    return { due: 0, sent: 0, failed: 0, error: String(err?.message || err) }
  }
  let sent = 0, failed = 0, deferred = 0
  for (const m of dueMsgs) {
    // New-conversation throttle: check before claiming so a deferred reminder stays pending.
    if (m.phone && await isNewConversation(m.phone)) {
      const r = await tryReserveNewConversation(m.phone, NEW_CONVO_CAP)
      if (!r.ok) { deferred++; continue }
    }

    let claimed
    try {
      claimed = await claimScheduledMessage(m.id)
    } catch (err) {
      // Transient claim failure: leave the row pending for the next tick.
      console.error('sequence-tick: claim failed for scheduled message', m.id, err)
      continue
    }
    if (!claimed) continue
    try {
      const r = await sendImessage({
        phone: m.phone,
        message: m.message || undefined,
        mediaUrl: m.media_url || undefined,
        leadId: m.close_lead_id || undefined
      })
      await markScheduledSent(m.id, { handle: r?.send?.message_handle })
      sent++
    } catch (err) {
      await markScheduledFailed(m.id, String(err?.message || err))
      failed++
    }
  }
  return { due: dueMsgs.length, sent, failed, deferred }
}

async function fireOne({ enrollment, step, scheduledFor, totalSteps }) {
  // New-conversation throttle: check before advancing enrollment so a deferred
  // step isn't consumed. Uses enrollment.phone (the canonical outbound number).
  if (enrollment.phone && await isNewConversation(enrollment.phone)) {
    const r = await tryReserveNewConversation(enrollment.phone, NEW_CONVO_CAP)
    if (!r.ok) return { deferred: true }
  }

  // Atomically claim this step so concurrent cron runs don't double-fire.
  const claimed = await tryAdvanceEnrollment(enrollment.id, enrollment.next_step_position)
  if (!claimed) return { fired: false, skipped: 'lost race' }

  // Render the message template against the lead snapshot. We pull from Close
  // at fire-time so {{lead.display_name}} reflects current values.
  let leadSnapshot = {}
  try {
    const lead = await getLead(enrollment.lead_id)
    leadSnapshot = {
      lead: {
        id: lead.id,
        display_name: lead.display_name,
        status_label: lead.status_label,
        contact: lead.contacts?.[0] ? {
          name: lead.contacts[0].name,
          phone: lead.contacts[0].phones?.[0]?.phone,
          email: lead.contacts[0].emails?.[0]?.email
        } : null
      }
    }
  } catch (err) {
    console.error(`sequence-tick: getLead failed for ${enrollment.lead_id}`, err)
  }

  const message = renderTemplate(step.message_template || '', leadSnapshot)
  const phone = enrollment.phone || leadSnapshot.lead?.contact?.phone
  if (!phone) {
    await recordSend({
      enrollmentId: enrollment.id, stepId: step.id, scheduledFor,
      error: 'no phone on enrollment or lead'
    })
    return { error: 'no phone' }
  }

  let sent
  try {
    sent = await sendImessage({
      phone,
      message,
      mediaUrl: step.media_url || undefined,
      leadId: enrollment.lead_id,
      contactId: enrollment.contact_id,
      leadName: leadSnapshot.lead?.display_name
    })
  } catch (err) {
    await recordSend({
      enrollmentId: enrollment.id, stepId: step.id, scheduledFor,
      error: String(err?.message || err)
    })
    if (String(err?.message || err).includes('opted out')) {
      try { await unenrollAllForLead(enrollment.lead_id, 'opted-out') } catch (e) { console.error('fireOne unenroll failed', e) }
    }
    return { error: String(err?.message || err) }
  }

  await recordSend({
    enrollmentId: enrollment.id,
    stepId: step.id,
    scheduledFor,
    sentAt: new Date(),
    messageHandle: sent?.send?.message_handle
  })

  // If this was the last step, mark the enrollment completed.
  if (enrollment.next_step_position + 1 >= totalSteps) {
    await markCompleted(enrollment.id)
    return { fired: true, completed: true }
  }
  return { fired: true }
}
