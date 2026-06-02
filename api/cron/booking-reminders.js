import { findDueReminders, claimReminder, buildReminderEmail } from '../../lib/reminders.js'
import { sendEmail } from '../../lib/close.js'
import { getSupabase } from '../../lib/supabase.js'

// Same auth as api/cron/sequence-tick: Vercel Cron sends Bearer CRON_SECRET
// (and x-vercel-cron on Vercel). Verify both.
function verifyCron(req) {
  const auth = req.headers?.authorization
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true
  if (req.headers?.['x-vercel-cron'] === '1') return true
  return false
}

export default async function handler(req, res) {
  if (!verifyCron(req)) return res.status(401).json({ error: 'unauthorized cron call' })

  let due
  try {
    due = await findDueReminders({ now: new Date(), limit: 50 })
  } catch (err) {
    console.error('booking-reminders: findDueReminders failed', err)
    return res.status(500).json({ error: String(err?.message || err) })
  }
  if (due.length === 0) return res.status(200).json({ ok: true, sent: 0, message: 'nothing due' })

  const results = await Promise.allSettled(due.map(b => fireOne(b)))
  const sent = results.filter(r => r.status === 'fulfilled' && r.value.sent).length
  const failed = results.filter(r => r.status === 'fulfilled' && r.value.error).length
  return res.status(200).json({ ok: true, due: due.length, sent, failed })
}

async function fireOne(booking) {
  const claimed = await claimReminder(booking.id)
  if (!claimed) return { sent: false, skipped: 'lost race' }

  const { to, subject, bodyText, bodyHtml } = buildReminderEmail(booking)
  const sender = process.env.CLOSE_REMINDER_FROM
  if (!to || !sender || !booking.close_lead_id) {
    await logErr(booking, `missing fields (to=${!!to} sender=${!!sender} lead=${!!booking.close_lead_id})`)
    return { error: 'missing fields' }
  }
  try {
    await sendEmail({ leadId: booking.close_lead_id, to, sender, subject, bodyText, bodyHtml })
  } catch (err) {
    await logErr(booking, String(err?.message || err))
    return { error: String(err?.message || err) }
  }
  return { sent: true }
}

async function logErr(booking, message) {
  try {
    await getSupabase().from('lead_sync_errors').insert({
      lead_id: booking.lead_id || null,
      service: 'calendly-reminder',
      operation: 'send-reminder',
      error_message: message,
      payload: { calendly_booking_id: booking.id, close_lead_id: booking.close_lead_id }
    })
  } catch (e) {
    console.error('booking-reminders: lead_sync_errors insert threw', e)
  }
}
