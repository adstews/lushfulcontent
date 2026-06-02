// lib/scheduled-messages.js
import { getSupabase } from './supabase.js'
import { normalizePhone } from './sendblue.js'

const iso = (d) => (d instanceof Date ? d.toISOString() : d)

// Schedule a one-off message. Idempotent on dedup_key (unique). No-op without
// a usable phone or any payload.
export async function scheduleMessage({ phone, closeLeadId = null, message = null, mediaUrl = null, sendAt, dedupKey = null, source = 'manual' }) {
  const normalized = normalizePhone(phone)
  if (!normalized) return { ok: false, skipped: 'no phone' }
  if (!message && !mediaUrl) return { ok: false, skipped: 'no payload' }
  const sb = getSupabase()
  const { error } = await sb.from('imessage_scheduled_messages').insert({
    phone: normalized,
    close_lead_id: closeLeadId,
    message,
    media_url: mediaUrl,
    send_at: iso(sendAt),
    status: 'pending',
    source,
    dedup_key: dedupKey
  })
  if (error) {
    if (String(error.message).includes('duplicate key')) return { ok: true, deduped: true }
    throw new Error(error.message)
  }
  return { ok: true }
}

export async function findDueScheduledMessages({ now = new Date(), limit = 50 } = {}) {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('imessage_scheduled_messages')
    .select('id, phone, close_lead_id, message, media_url, send_at')
    .eq('status', 'pending')
    .lte('send_at', iso(now))
    .limit(limit)
  if (error) throw new Error(error.message)
  return data || []
}

// Atomic claim: pending -> sending. Returns true if we won the row.
export async function claimScheduledMessage(id) {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('imessage_scheduled_messages')
    .update({ status: 'sending' })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
  if (error) throw new Error(error.message)
  return Array.isArray(data) && data.length > 0
}

export async function markScheduledSent(id, { sentAt = new Date(), handle = null } = {}) {
  const sb = getSupabase()
  const { error } = await sb
    .from('imessage_scheduled_messages')
    .update({ status: 'sent', sent_at: iso(sentAt), message_handle: handle })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function markScheduledFailed(id, errMsg) {
  const sb = getSupabase()
  const { error } = await sb
    .from('imessage_scheduled_messages')
    .update({ status: 'failed', error: String(errMsg) })
    .eq('id', id)
  if (error) throw new Error(error.message)
}
