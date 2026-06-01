import { getSupabase } from '../lib/supabase.js'
import { parseInviteeCreated, verifySecret } from '../lib/calendly.js'
import {
  createLead,
  updateLead,
  createNote,
  findLeadByEmail,
  findLeadByPhone
} from '../lib/close.js'

// Calendly doesn't issue a signing key for this account, so we authenticate the
// webhook with a shared secret carried in the callback URL (?secret=...) — the
// same pattern as api/sendblue/close-webhook.js. No HMAC means no raw-body
// requirement: the platform-parsed req.body is fine.

function normalizePhone(phone) {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

function buildNote(parsed) {
  const lines = ['📅 Calendly booking confirmed']
  if (parsed.eventName) lines.push(`Event: ${parsed.eventName}`)
  if (parsed.startTime) {
    let when = parsed.startTime
    try {
      when = new Date(parsed.startTime).toLocaleString('en-US', {
        timeZone: parsed.timezone || 'UTC',
        dateStyle: 'medium',
        timeStyle: 'short'
      })
    } catch { /* keep ISO */ }
    lines.push(`When: ${when}${parsed.timezone ? ` (${parsed.timezone})` : ''}`)
  }
  const campaign = [parsed.utm.source, parsed.utm.campaign].filter(Boolean).join(' / ')
  if (campaign) lines.push(`Campaign: ${campaign}`)
  const answered = parsed.questionsAndAnswers.filter(qa => qa.answer)
  if (answered.length > 0) {
    lines.push('— Answers —')
    for (const qa of answered) lines.push(`${qa.question}: ${qa.answer}`)
  }
  return lines.join('\n')
}

async function createDirectLead(sb, parsed) {
  const SOURCE = 'calendly-direct'
  const customFields = {}
  if (process.env.CLOSE_CF_SOURCE) customFields[process.env.CLOSE_CF_SOURCE] = SOURCE
  if (process.env.CLOSE_CF_BOOKED) customFields[process.env.CLOSE_CF_BOOKED] = 'Call'
  const utmFields = [
    ['CLOSE_CF_UTM_SOURCE', parsed.utm.source],
    ['CLOSE_CF_UTM_MEDIUM', parsed.utm.medium],
    ['CLOSE_CF_UTM_CAMPAIGN', parsed.utm.campaign],
    ['CLOSE_CF_UTM_CONTENT', parsed.utm.content],
    ['CLOSE_CF_UTM_TERM', parsed.utm.term]
  ]
  for (const [envName, val] of utmFields) {
    if (val && process.env[envName]) customFields[process.env[envName]] = val
  }
  if (process.env.CLOSE_CF_CALL_TIME && parsed.startTime) {
    customFields[process.env.CLOSE_CF_CALL_TIME] = parsed.startTime
  }

  const { closeLeadId } = await createLead({
    name: parsed.name,
    email: parsed.email,
    phone: parsed.phone,
    statusId: process.env.CLOSE_STATUS_CALL_BOOKED,
    customFields
  })

  let leadRowId = null
  try {
    const { data: row } = await sb
      .from('leads')
      .upsert({
        name: parsed.name,
        email: parsed.email,
        phone: parsed.phone,
        source: SOURCE,
        cta_clicked: 'book-calendly',
        utm_source: parsed.utm.source,
        utm_medium: parsed.utm.medium,
        utm_campaign: parsed.utm.campaign,
        utm_content: parsed.utm.content,
        utm_term: parsed.utm.term,
        close_lead_id: closeLeadId,
        close_synced_at: new Date().toISOString()
      }, { onConflict: 'email,source' })
      .select('id')
      .single()
    leadRowId = row ? row.id : null
  } catch (err) {
    console.error('calendly-webhook: supabase mirror failed', err)
  }

  return { closeLeadId, leadRowId, matchedBy: 'created', created: true }
}

async function resolveLead(sb, parsed) {
  // 1. Supabase leads by email (we own the close_lead_id mapping). Exact match
  // on the lowercased email — avoids SQL LIKE wildcard semantics from
  // attacker-supplied addresses (e.g. `a_b@x.com`). Mixed-case stored rows fall
  // through to the case-insensitive Close search below.
  const { data: rows, error: rowsErr } = await sb
    .from('leads')
    .select('id, close_lead_id')
    .eq('email', parsed.email)
    .not('close_lead_id', 'is', null)
    .limit(1)
  if (rowsErr) throw new Error(`leads email lookup failed: ${rowsErr.message}`)
  const sbLead = rows && rows[0]
  if (sbLead && sbLead.close_lead_id) {
    return { closeLeadId: sbLead.close_lead_id, leadRowId: sbLead.id, matchedBy: 'email', created: false }
  }

  // 2. Close by email.
  const byEmail = await findLeadByEmail(parsed.email)
  if (byEmail && byEmail.closeLeadId) {
    return { closeLeadId: byEmail.closeLeadId, leadRowId: null, matchedBy: 'email', created: false }
  }

  // 3. Close by phone.
  const phone = normalizePhone(parsed.phone)
  if (phone) {
    const byPhone = await findLeadByPhone(phone)
    if (byPhone && byPhone.closeLeadId) {
      return { closeLeadId: byPhone.closeLeadId, leadRowId: null, matchedBy: 'phone', created: false }
    }
  }

  // 4. No match → create.
  return createDirectLead(sb, parsed)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }

  if (!verifySecret(req, process.env.CALENDLY_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'invalid secret' })
  }

  const body = req.body || {}
  if (body.event !== 'invitee.created') {
    return res.status(200).json({ ok: true, skipped: 'not invitee.created' })
  }

  const parsed = parseInviteeCreated(body)
  if (!parsed.inviteeUri || !parsed.email) {
    return res.status(200).json({ ok: true, skipped: 'missing invitee uri or email' })
  }

  const sb = getSupabase()

  try {
    const missing = ['CLOSE_STATUS_CALL_BOOKED', 'CLOSE_CF_BOOKED'].filter(v => !process.env[v])
    if (missing.length > 0) throw new Error(`Close env vars missing: ${missing.join(', ')}`)

    // Idempotency: Calendly retries failed deliveries; skip ones we've handled.
    const { data: dup, error: dupErr } = await sb
      .from('calendly_bookings')
      .select('id')
      .eq('invitee_uri', parsed.inviteeUri)
      .limit(1)
    if (dupErr) throw new Error(`calendly_bookings lookup failed: ${dupErr.message}`)
    if (dup && dup.length > 0) {
      return res.status(200).json({ ok: true, skipped: 'already processed' })
    }

    const resolved = await resolveLead(sb, parsed)

    if (!resolved.created) {
      const matchedFields = { [process.env.CLOSE_CF_BOOKED]: 'Call' }
      if (process.env.CLOSE_CF_CALL_TIME && parsed.startTime) {
        matchedFields[process.env.CLOSE_CF_CALL_TIME] = parsed.startTime
      }
      await updateLead({
        leadId: resolved.closeLeadId,
        statusId: process.env.CLOSE_STATUS_CALL_BOOKED,
        customFields: matchedFields
      })
    }

    await createNote({ leadId: resolved.closeLeadId, note: buildNote(parsed) })

    await sb.from('calendly_bookings').insert({
      invitee_uri: parsed.inviteeUri,
      event_uri: parsed.eventUri,
      lead_id: resolved.leadRowId,
      close_lead_id: resolved.closeLeadId,
      scheduled_at: parsed.startTime,
      matched_by: resolved.matchedBy,
      raw: body
    })

    return res.status(200).json({ ok: true, matchedBy: resolved.matchedBy, closeLeadId: resolved.closeLeadId })
  } catch (err) {
    console.error('calendly-webhook processing failed', err)
    try {
      await sb.from('lead_sync_errors').insert({
        lead_id: null,
        service: 'calendly',
        operation: 'invitee.created',
        error_message: String((err && err.message) || err),
        payload: body
      })
    } catch (insertErr) {
      console.error('lead_sync_errors insert threw', insertErr)
    }
    return res.status(500).json({ error: 'processing failed' })
  }
}
