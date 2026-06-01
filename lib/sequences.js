import { getSupabase } from './supabase.js'
import { isSuppressed } from './opt-outs.js'

// ============================================================
// Sequence CRUD
// ============================================================

export async function listSequences() {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('imessage_sequences')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function getSequence(id) {
  const sb = getSupabase()
  const [seqRes, stepsRes] = await Promise.all([
    sb.from('imessage_sequences').select('*').eq('id', id).single(),
    sb.from('imessage_sequence_steps').select('*').eq('sequence_id', id)
      .order('delay_seconds', { ascending: true }).order('position', { ascending: true })
  ])
  if (seqRes.error) throw new Error(seqRes.error.message)
  if (stepsRes.error) throw new Error(stepsRes.error.message)
  return { ...seqRes.data, steps: stepsRes.data || [] }
}

export async function createSequence({ name, triggerType, triggerStatusId, onReplyBehavior, active, steps }) {
  const sb = getSupabase()
  const { data, error } = await sb.from('imessage_sequences').insert({
    name,
    trigger_type: triggerType || 'manual',
    trigger_status_id: triggerStatusId ?? null,
    on_reply_behavior: onReplyBehavior || 'pause',
    active: active ?? true
  }).select('*').single()
  if (error) throw new Error(error.message)
  if (Array.isArray(steps) && steps.length > 0) {
    await replaceSequenceSteps(data.id, steps)
  }
  return getSequence(data.id)
}

export async function updateSequence(id, { name, triggerType, triggerStatusId, onReplyBehavior, active, steps }) {
  const sb = getSupabase()
  const patch = {}
  if (name !== undefined) patch.name = name
  if (triggerType !== undefined) patch.trigger_type = triggerType
  if (triggerStatusId !== undefined) patch.trigger_status_id = triggerStatusId
  if (onReplyBehavior !== undefined) patch.on_reply_behavior = onReplyBehavior
  if (active !== undefined) patch.active = active
  if (Object.keys(patch).length > 0) {
    const { error } = await sb.from('imessage_sequences').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
  }
  if (Array.isArray(steps)) {
    await replaceSequenceSteps(id, steps)
  }
  return getSequence(id)
}

export async function deleteSequence(id) {
  const sb = getSupabase()
  const { error } = await sb.from('imessage_sequences').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// Replace all steps for a sequence atomically. Each step is
// { delaySeconds, messageTemplate, mediaUrl, position? }.
async function replaceSequenceSteps(sequenceId, steps) {
  const sb = getSupabase()
  const { error: delErr } = await sb.from('imessage_sequence_steps').delete().eq('sequence_id', sequenceId)
  if (delErr) throw new Error(delErr.message)
  if (steps.length === 0) return
  const rows = steps.map((s, i) => ({
    sequence_id: sequenceId,
    position: typeof s.position === 'number' ? s.position : i,
    delay_seconds: s.delaySeconds ?? 0,
    message_template: s.messageTemplate ?? null,
    media_url: s.mediaUrl ?? null
  }))
  const { error: insErr } = await sb.from('imessage_sequence_steps').insert(rows)
  if (insErr) throw new Error(insErr.message)
}

// ============================================================
// Enrollment
// ============================================================

// Idempotent: if the lead is already enrolled in this sequence with a
// non-terminal status, returns the existing enrollment instead of creating
// a duplicate. A previously unenrolled/completed lead CAN be re-enrolled.
export async function enrollLead({ sequenceId, leadId, phone, contactId, source = 'manual' }) {
  if (!sequenceId) throw new Error('sequenceId required')
  if (!leadId) throw new Error('leadId required')

  if (await isSuppressed({ phone, leadId })) {
    return { skipped: 'opted-out', sequenceId, leadId }
  }

  const sb = getSupabase()

  // If an active or paused enrollment exists, return it (don't double-enroll)
  const { data: existing, error: lookupErr } = await sb
    .from('imessage_sequence_enrollments')
    .select('*')
    .eq('sequence_id', sequenceId)
    .eq('lead_id', leadId)
    .in('status', ['active', 'paused'])
    .maybeSingle()
  if (lookupErr) throw new Error(lookupErr.message)
  if (existing) return { ...existing, alreadyEnrolled: true }

  // Upsert: re-enroll if a prior terminal enrollment exists, else insert fresh.
  // (We rely on the unique (sequence_id, lead_id) constraint and reset state.)
  const { data, error } = await sb
    .from('imessage_sequence_enrollments')
    .upsert(
      {
        sequence_id: sequenceId,
        lead_id: leadId,
        phone: phone ?? null,
        contact_id: contactId ?? null,
        status: 'active',
        next_step_position: 0,
        enrolled_at: new Date().toISOString(),
        paused_at: null,
        paused_reason: null,
        completed_at: null
      },
      { onConflict: 'sequence_id,lead_id' }
    )
    .select('*')
    .single()
  if (error) throw new Error(error.message)

  // Also clear any send-history rows so the re-enrolled lead receives messages again.
  await sb.from('imessage_sequence_sends').delete().eq('enrollment_id', data.id)

  return { ...data, source }
}

export async function pauseEnrollment(enrollmentId, reason = 'manual') {
  const sb = getSupabase()
  const { error } = await sb
    .from('imessage_sequence_enrollments')
    .update({
      status: 'paused',
      paused_at: new Date().toISOString(),
      paused_reason: reason
    })
    .eq('id', enrollmentId)
    .eq('status', 'active') // only pause from active — don't restart a terminal enrollment
  if (error) throw new Error(error.message)
}

export async function resumeEnrollment(enrollmentId) {
  const sb = getSupabase()
  const { error } = await sb
    .from('imessage_sequence_enrollments')
    .update({ status: 'active', paused_at: null, paused_reason: null })
    .eq('id', enrollmentId)
    .eq('status', 'paused')
  if (error) throw new Error(error.message)
}

export async function unenrollEnrollment(enrollmentId, reason = 'manual') {
  const sb = getSupabase()
  const { error } = await sb
    .from('imessage_sequence_enrollments')
    .update({ status: 'unenrolled', paused_reason: reason })
    .eq('id', enrollmentId)
    .in('status', ['active', 'paused'])
  if (error) throw new Error(error.message)
}

// Pause every active enrollment for a lead. Called from the inbound webhook
// (reply landed) and from the console reply path (human took over).
// Respects each sequence's on_reply_behavior:
//   pause     → status becomes paused
//   unenroll  → status becomes unenrolled
//   continue  → no-op
export async function pauseEnrollmentsForLead(leadId, reason = 'reply') {
  const sb = getSupabase()
  const { data: enrollments, error } = await sb
    .from('imessage_sequence_enrollments')
    .select('id, sequence_id, status')
    .eq('lead_id', leadId)
    .eq('status', 'active')
  if (error) throw new Error(error.message)
  if (!enrollments || enrollments.length === 0) return { affected: 0 }

  const sequenceIds = [...new Set(enrollments.map(e => e.sequence_id))]
  const { data: seqs, error: seqErr } = await sb
    .from('imessage_sequences')
    .select('id, on_reply_behavior')
    .in('id', sequenceIds)
  if (seqErr) throw new Error(seqErr.message)
  const behaviorBySeq = new Map((seqs || []).map(s => [s.id, s.on_reply_behavior]))

  let affected = 0
  for (const e of enrollments) {
    const behavior = behaviorBySeq.get(e.sequence_id) || 'pause'
    if (behavior === 'continue') continue
    const update = behavior === 'unenroll'
      ? { status: 'unenrolled', paused_reason: reason }
      : { status: 'paused', paused_at: new Date().toISOString(), paused_reason: reason }
    const { error: updErr } = await sb
      .from('imessage_sequence_enrollments')
      .update(update)
      .eq('id', e.id)
    if (!updErr) affected++
  }
  return { affected, total: enrollments.length }
}

// STOP / unsubscribe — hard unenroll from ALL sequences regardless of behavior.
export async function unenrollAllForLead(leadId, reason = 'stop') {
  const sb = getSupabase()
  const { error } = await sb
    .from('imessage_sequence_enrollments')
    .update({ status: 'unenrolled', paused_reason: reason })
    .eq('lead_id', leadId)
    .in('status', ['active', 'paused'])
  if (error) throw new Error(error.message)
}

const STOP_REGEX = /^\s*(stop|unsubscribe|end|cancel|quit|stopall)\s*\.?\s*$/i

export function isStopKeyword(text) {
  if (typeof text !== 'string') return false
  return STOP_REGEX.test(text)
}

export async function listEnrollmentsForLead(leadId) {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('imessage_sequence_enrollments')
    .select('id, sequence_id, status, next_step_position, enrolled_at, paused_at, paused_reason, completed_at')
    .eq('lead_id', leadId)
    .order('enrolled_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

// ============================================================
// Trigger by Close lead status (auto-enroll)
// ============================================================

export async function findSequencesForStatusTrigger(statusId) {
  if (!statusId) return []
  const sb = getSupabase()
  const { data, error } = await sb
    .from('imessage_sequences')
    .select('id, name')
    .eq('trigger_type', 'lead_status')
    .eq('trigger_status_id', statusId)
    .eq('active', true)
  if (error) throw new Error(error.message)
  return data || []
}

// ============================================================
// Cron tick: find and fire due sends
// ============================================================

// Returns the list of due (enrollment, step) pairs to fire now. A step is due
// when (enrolled_at + sum of delays through this step) <= now, the step has
// not already been recorded in imessage_sequence_sends for this enrollment,
// and the enrollment is still active.
export async function findDueSends({ now = new Date(), limit = 100 } = {}) {
  const sb = getSupabase()
  // Pull active enrollments past their enrollment time. We do the cumulative
  // delay math in JS because it depends on the step list per sequence and
  // representing it in pure SQL gets ugly.
  const { data: enrollments, error } = await sb
    .from('imessage_sequence_enrollments')
    .select('id, sequence_id, lead_id, phone, contact_id, next_step_position, enrolled_at')
    .eq('status', 'active')
    .limit(limit)
  if (error) throw new Error(error.message)
  if (!enrollments || enrollments.length === 0) return []

  const sequenceIds = [...new Set(enrollments.map(e => e.sequence_id))]
  const { data: steps, error: stepsErr } = await sb
    .from('imessage_sequence_steps')
    .select('id, sequence_id, delay_seconds, position, message_template, media_url')
    .in('sequence_id', sequenceIds)
    .order('delay_seconds', { ascending: true })
    .order('position', { ascending: true })
  if (stepsErr) throw new Error(stepsErr.message)
  const stepsBySeq = new Map()
  for (const s of steps || []) {
    if (!stepsBySeq.has(s.sequence_id)) stepsBySeq.set(s.sequence_id, [])
    stepsBySeq.get(s.sequence_id).push(s)
  }

  const due = []
  for (const e of enrollments) {
    const stepsForSeq = stepsBySeq.get(e.sequence_id) || []
    const nextStep = stepsForSeq[e.next_step_position]
    if (!nextStep) continue // No more steps — handled separately (mark completed)
    const scheduledFor = new Date(new Date(e.enrolled_at).getTime() + nextStep.delay_seconds * 1000)
    if (scheduledFor.getTime() <= now.getTime()) {
      due.push({ enrollment: e, step: nextStep, scheduledFor, totalSteps: stepsForSeq.length })
    }
  }
  return due
}

// Mark an enrollment as completed (all steps fired).
export async function markCompleted(enrollmentId) {
  const sb = getSupabase()
  const { error } = await sb
    .from('imessage_sequence_enrollments')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', enrollmentId)
    .eq('status', 'active')
  if (error) throw new Error(error.message)
}

// Atomically advance an enrollment's next_step_position. Used after a send
// succeeds. Returns true if the row was updated (we got the slot), false if
// some concurrent worker already advanced past this step.
export async function tryAdvanceEnrollment(enrollmentId, expectedPosition) {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('imessage_sequence_enrollments')
    .update({ next_step_position: expectedPosition + 1 })
    .eq('id', enrollmentId)
    .eq('next_step_position', expectedPosition)
    .eq('status', 'active')
    .select('id')
  if (error) throw new Error(error.message)
  return Array.isArray(data) && data.length > 0
}

// Record a send attempt. Uses the unique (enrollment_id, step_id) constraint
// to prevent duplicates if the cron retries. Returns true on insert success,
// false if a row already existed (i.e. we lost the race).
export async function recordSend({ enrollmentId, stepId, scheduledFor, sentAt, messageHandle, error: errMsg }) {
  const sb = getSupabase()
  const { error } = await sb
    .from('imessage_sequence_sends')
    .insert({
      enrollment_id: enrollmentId,
      step_id: stepId,
      scheduled_for: scheduledFor instanceof Date ? scheduledFor.toISOString() : scheduledFor,
      sent_at: sentAt instanceof Date ? sentAt.toISOString() : (sentAt ?? null),
      message_handle: messageHandle ?? null,
      error: errMsg ?? null
    })
  if (error) {
    if (String(error.message).includes('duplicate key')) return false
    throw new Error(error.message)
  }
  return true
}

// Render `{{lead.x}}` style variables in a message template. We pre-fetch
// from Close at enroll time, but for templates rendered at send time we pass
// in the current lead snapshot here.
export function renderTemplate(template, vars = {}) {
  if (!template) return ''
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path) => {
    const parts = path.split('.')
    let v = vars
    for (const p of parts) {
      if (v == null) return ''
      v = v[p]
    }
    return v == null ? '' : String(v)
  })
}
