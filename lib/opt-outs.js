import { getSupabase } from './supabase.js'
import { normalizePhone } from './sendblue.js'

// Add a phone to the permanent opt-out list. Idempotent (upsert on phone PK).
// No-op when the phone can't be normalized.
export async function suppressPhone({ phone, leadId = null, reason = 'stop-keyword' }) {
  const normalized = normalizePhone(phone)
  if (!normalized) return { ok: false, skipped: 'no phone' }
  const sb = getSupabase()
  const { error } = await sb
    .from('imessage_opt_outs')
    .upsert(
      { phone: normalized, close_lead_id: leadId ?? null, reason },
      { onConflict: 'phone' }
    )
  if (error) throw new Error(error.message)
  return { ok: true, phone: normalized }
}

// True if the phone OR the close_lead_id is on the opt-out list. Either
// identifier is sufficient — a number can change leads, a lead its number.
export async function isSuppressed({ phone = null, leadId = null }) {
  const normalized = phone ? normalizePhone(phone) : null
  if (!normalized && !leadId) return false
  const sb = getSupabase()
  let q = sb.from('imessage_opt_outs').select('phone')
  if (normalized && leadId) {
    q = q.or(`phone.eq.${normalized},close_lead_id.eq.${leadId}`)
  } else if (normalized) {
    q = q.eq('phone', normalized)
  } else {
    q = q.eq('close_lead_id', leadId)
  }
  const { data, error } = await q.limit(1)
  if (error) throw new Error(error.message)
  return Array.isArray(data) && data.length > 0
}
