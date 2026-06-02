import { getSupabase } from './supabase.js'
import { normalizePhone } from './phone.js'

function startOfUtcDayIso(now) {
  const d = new Date(now)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString()
}

export async function isNewConversation(phone) {
  const n = normalizePhone(phone)
  if (!n) return false
  const sb = getSupabase()
  const { data, error } = await sb.from('imessage_contacts').select('phone').eq('phone', n).limit(1)
  if (error) throw new Error(error.message)
  return !(Array.isArray(data) && data.length > 0)
}

async function newConvosToday(sb, now) {
  const { count, error } = await sb
    .from('imessage_contacts')
    .select('phone', { count: 'exact', head: true })
    .gte('first_contacted_at', startOfUtcDayIso(now))
  if (error) throw new Error(error.message)
  return count || 0
}

// Reserve a new-conversation slot. Already-contacted phones return ok:true,
// isNew:false and do NOT count. New phones consume a slot only if under cap.
export async function tryReserveNewConversation(phone, cap, now = new Date()) {
  const n = normalizePhone(phone)
  if (!n) return { ok: false, reason: 'bad-phone' }
  const sb = getSupabase()
  const { data: existing, error: exErr } = await sb.from('imessage_contacts').select('phone').eq('phone', n).limit(1)
  if (exErr) throw new Error(exErr.message)
  if (Array.isArray(existing) && existing.length > 0) return { ok: true, isNew: false }
  if ((await newConvosToday(sb, now)) >= cap) return { ok: false, reason: 'daily-cap' }
  const { error: insErr } = await sb.from('imessage_contacts').insert({ phone: n, first_contacted_at: new Date(now).toISOString() })
  if (insErr) {
    if (String(insErr.message).includes('duplicate key')) return { ok: true, isNew: false } // raced; already contacted
    throw new Error(insErr.message)
  }
  return { ok: true, isNew: true }
}
