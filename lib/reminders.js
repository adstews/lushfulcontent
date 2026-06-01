import { getSupabase } from './supabase.js'

const WINDOW_MS = 30 * 60 * 1000

// Bookings whose call starts within the next 30 minutes and haven't been
// reminded. scheduled_at > now excludes calls already started/past.
export async function findDueReminders({ now, limit = 50 }) {
  const sb = getSupabase()
  const nowIso = now.toISOString()
  const cutoffIso = new Date(now.getTime() + WINDOW_MS).toISOString()
  const { data, error } = await sb
    .from('calendly_bookings')
    .select('id, lead_id, close_lead_id, scheduled_at, raw')
    .is('reminder_sent_at', null)
    .gt('scheduled_at', nowIso)
    .lte('scheduled_at', cutoffIso)
    .order('scheduled_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`findDueReminders failed: ${error.message}`)
  return data || []
}

// Atomically claim a booking: set reminder_sent_at only if still null. Returns
// true if we won the claim, false if another tick already took it.
export async function claimReminder(id) {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('calendly_bookings')
    .update({ reminder_sent_at: new Date().toISOString() })
    .eq('id', id)
    .is('reminder_sent_at', null)
    .select('id')
  if (error) throw new Error(`claimReminder failed: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}
function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

// Build the reminder email from a booking row's stored Calendly payload.
export function buildReminderEmail(booking) {
  const p = (booking.raw && booking.raw.payload) || {}
  const to = (p.email || '').trim()
  const firstName = ((p.name || '').trim().split(/\s+/)[0]) || 'there'
  const tz = p.timezone || 'UTC'
  const startIso = p.scheduled_event && p.scheduled_event.start_time
  let when = startIso || ''
  if (startIso) {
    try {
      when = new Date(startIso).toLocaleString('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })
    } catch { when = startIso }
  }
  const reschedule = p.reschedule_url || ''
  const cancel = p.cancel_url || ''

  const subject = `Reminder: your Lushful consult is at ${when}`

  const text = [`Hi ${firstName},`, '',
    `A quick reminder that your Lushful Aesthetics consultation is coming up at ${when} (${tz}) — about 30 minutes away.`]
  if (reschedule || cancel) {
    text.push('', 'Need to make a change?')
    if (reschedule) text.push(`• Reschedule: ${reschedule}`)
    if (cancel) text.push(`• Cancel: ${cancel}`)
  }
  text.push('', 'Talk soon!', '— Lushful Aesthetics')

  const html = [`<p>Hi ${escapeHtml(firstName)},</p>`,
    `<p>A quick reminder that your Lushful Aesthetics consultation is coming up at <strong>${escapeHtml(when)}</strong> (${escapeHtml(tz)}) — about 30 minutes away.</p>`]
  if (reschedule || cancel) {
    const links = []
    if (reschedule) links.push(`<a href="${escapeAttr(reschedule)}">Reschedule</a>`)
    if (cancel) links.push(`<a href="${escapeAttr(cancel)}">Cancel</a>`)
    html.push(`<p>Need to make a change? ${links.join(' &middot; ')}</p>`)
  }
  html.push('<p>Talk soon!<br>— Lushful Aesthetics</p>')

  return { to, subject, bodyText: text.join('\n'), bodyHtml: html.join('\n') }
}
