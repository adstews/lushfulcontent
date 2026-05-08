import { z } from 'zod'
import { getSupabase } from '../lib/supabase.js'
import { addTags } from '../lib/mailchimp.js'
import { updateLead } from '../lib/close.js'

const BodySchema = z.object({
  lead_id: z.string().min(1),
  qualified: z.boolean().optional(),
  cta_clicked: z.enum(['book', 'call', 'tap-to-call']).optional()
}).refine(
  d => d.qualified !== undefined || d.cta_clicked !== undefined,
  { message: 'one of qualified or cta_clicked is required' }
)

const CTA_LABELS = {
  'book': 'Book Appointment',
  'call': 'Schedule a Call',
  'tap-to-call': 'Tap to Call'
}

function taggedTask(service, fn) {
  return fn().catch(err => {
    err.service = service
    throw err
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }

  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      error: 'validation failed',
      details: parsed.error.flatten()
    })
  }
  const body = parsed.data
  const sb = getSupabase()

  // Fetch the lead so we know email + source + close_lead_id
  const { data: lead, error: fetchErr } = await sb
    .from('leads')
    .select('id, email, source, close_lead_id')
    .eq('id', body.lead_id)
    .single()

  if (fetchErr || !lead) {
    return res.status(404).json({ error: 'lead not found' })
  }

  // 1. Update Supabase
  const updates = { updated_at: new Date().toISOString() }
  if (body.qualified !== undefined) {
    updates.qualified = body.qualified
    updates.qualified_at = new Date().toISOString()
  }
  if (body.cta_clicked !== undefined) {
    updates.cta_clicked = body.cta_clicked
  }
  const { error: updateErr } = await sb
    .from('leads')
    .update(updates)
    .eq('id', body.lead_id)
  if (updateErr) {
    console.error('supabase update failed', updateErr)
    try {
      const { error: insertErr } = await sb.from('lead_sync_errors').insert({
        lead_id: body.lead_id,
        service: 'supabase',
        operation: 'update',
        error_message: updateErr.message,
        payload: body
      })
      if (insertErr) console.error('lead_sync_errors insert failed', insertErr)
    } catch (insertErr) {
      console.error('lead_sync_errors insert threw', insertErr)
    }
  }

  // 2. Best-effort fanout
  const tasks = []

  if (body.qualified !== undefined) {
    tasks.push(taggedTask('mailchimp', async () => {
      const tag = body.qualified ? 'girthfill-qualified' : 'girthfill-not-qualified'
      await addTags({ email: lead.email, tags: [tag] })
      return { service: 'mailchimp' }
    }))
  }

  // Any source that produced a Close lead (i.e. anything except the
  // age-gate carousel) gets Close updates on Step 3 CTA clicks.
  if (lead.source !== 'girthfill-carousel' && lead.close_lead_id) {
    tasks.push(taggedTask('close', async () => {
      const requiredCloseEnvVars = []
      if (body.qualified !== undefined) {
        requiredCloseEnvVars.push('CLOSE_STATUS_QUALIFIED', 'CLOSE_STATUS_BAD_FIT', 'CLOSE_CF_QUALIFIED')
      }
      if (body.cta_clicked !== undefined) {
        requiredCloseEnvVars.push('CLOSE_CF_CTA_CLICKED')
      }
      const missingVars = requiredCloseEnvVars.filter(v => !process.env[v])
      if (missingVars.length > 0) {
        throw new Error(`Close env vars missing: ${missingVars.join(', ')}`)
      }

      const customFields = {}
      let statusId
      if (body.qualified !== undefined) {
        customFields[process.env.CLOSE_CF_QUALIFIED] = body.qualified ? 'Yes' : 'No'
        statusId = body.qualified
          ? process.env.CLOSE_STATUS_QUALIFIED
          : process.env.CLOSE_STATUS_BAD_FIT
      }
      if (body.cta_clicked !== undefined) {
        customFields[process.env.CLOSE_CF_CTA_CLICKED] = CTA_LABELS[body.cta_clicked]
      }
      await updateLead({
        leadId: lead.close_lead_id,
        statusId,
        customFields
      })
      return { service: 'close' }
    }))
  }

  const results = await Promise.allSettled(tasks)
  for (const r of results) {
    if (r.status === 'rejected') {
      const err = r.reason
      console.error('sync failed', err)
      const service = err?.service ?? 'unknown'
      try {
        const { error: insertErr } = await sb.from('lead_sync_errors').insert({
          lead_id: body.lead_id,
          service,
          operation: 'update',
          error_message: String(err?.message || err),
          payload: body
        })
        if (insertErr) console.error('lead_sync_errors insert failed', insertErr)
      } catch (insertErr) {
        console.error('lead_sync_errors insert threw', insertErr)
      }
    }
  }

  return res.status(200).json({ ok: true })
}
