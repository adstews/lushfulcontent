import { z } from 'zod'
import { getSupabase } from '../lib/supabase.js'
import { upsertSubscriber, addTags } from '../lib/mailchimp.js'
import { createLead } from '../lib/close.js'

const BodySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().nullable().optional(),
  source: z.enum(['girthfill-landing', 'girthfill-carousel', 'girthfill-nyc', 'girthfill-sd']),
  utm_source: z.string().optional().nullable(),
  utm_medium: z.string().optional().nullable(),
  utm_campaign: z.string().optional().nullable(),
  utm_content: z.string().optional().nullable(),
  utm_term: z.string().optional().nullable(),
  fbclid: z.string().optional().nullable(),
  gclid: z.string().optional().nullable(),
  referrer: z.string().optional().nullable(),
  landing_page: z.string().optional().nullable(),
  user_agent: z.string().optional().nullable(),
  qualified: z.boolean().optional()
})

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

  // 1. Supabase upsert (fatal if it fails)
  const upsertRow = {
    name: body.name,
    email: body.email,
    phone: body.phone ?? null,
    source: body.source,
    utm_source: body.utm_source ?? null,
    utm_medium: body.utm_medium ?? null,
    utm_campaign: body.utm_campaign ?? null,
    utm_content: body.utm_content ?? null,
    utm_term: body.utm_term ?? null,
    fbclid: body.fbclid ?? null,
    gclid: body.gclid ?? null,
    referrer: body.referrer ?? null,
    landing_page: body.landing_page ?? null,
    user_agent: body.user_agent ?? null
  }
  if (body.qualified !== undefined) {
    upsertRow.qualified = body.qualified
    upsertRow.qualified_at = new Date().toISOString()
  }
  const { data: leadRow, error: upsertErr } = await sb
    .from('leads')
    .upsert(upsertRow, { onConflict: 'email,source' })
    .select('id')
    .single()

  if (upsertErr) {
    console.error('supabase upsert failed', upsertErr)
    return res.status(500).json({ error: 'failed to save lead' })
  }
  const leadId = leadRow.id

  // 2. Best-effort fanout
  // Use the source value directly as the Mailchimp tag so each landing
  // page (girthfill-nyc, girthfill-sd, etc.) gets its own segmentable tag.
  const mailchimpTags = [body.source, 'SQ Lander']
  if (body.qualified === true) mailchimpTags.push('girthfill-qualified')
  if (body.qualified === false) mailchimpTags.push('girthfill-not-qualified')

  // Tag each task with its service name so failures are unambiguous
  function taggedTask(service, fn) {
    return fn().catch(err => {
      err.service = service
      throw err
    })
  }

  const tasks = [
    taggedTask('mailchimp', async () => {
      const { subscriberHash } = await upsertSubscriber({
        email: body.email,
        mergeFields: {
          FNAME: body.name,
          PHONE: body.phone ?? '',
          SOURCE: body.source,
          UTM_SRC: body.utm_source ?? '',
          UTM_CAMP: body.utm_campaign ?? '',
          UTM_CONT: body.utm_content ?? ''
        }
      })
      await addTags({ email: body.email, tags: mailchimpTags })
      await sb.from('leads').update({
        mailchimp_subscriber_hash: subscriberHash,
        mailchimp_synced_at: new Date().toISOString()
      }).eq('id', leadId)
      return { service: 'mailchimp', ok: true }
    })
  ]

  // All real consult-form submissions flow to Close (any source except
  // the age-gate carousel, which intentionally stays out of the sales pipeline).
  if (body.source !== 'girthfill-carousel') {
    tasks.push(taggedTask('close', async () => {
      // Pick the right Close status based on qualified at create time.
      let statusVar = 'CLOSE_STATUS_NEW'
      if (body.qualified === true) statusVar = 'CLOSE_STATUS_QUALIFIED'
      if (body.qualified === false) statusVar = 'CLOSE_STATUS_BAD_FIT'

      const requiredCloseEnvVars = [
        statusVar,
        'CLOSE_CF_SOURCE',
        'CLOSE_CF_UTM_SOURCE',
        'CLOSE_CF_UTM_MEDIUM',
        'CLOSE_CF_UTM_CAMPAIGN',
        'CLOSE_CF_UTM_CONTENT',
        'CLOSE_CF_FBCLID',
        'CLOSE_CF_GCLID'
      ]
      if (body.qualified !== undefined) requiredCloseEnvVars.push('CLOSE_CF_QUALIFIED')
      const missingVars = requiredCloseEnvVars.filter(v => !process.env[v])
      if (missingVars.length > 0) {
        throw new Error(`Close env vars missing: ${missingVars.join(', ')}`)
      }
      const customFields = {
        [process.env.CLOSE_CF_SOURCE]: body.source
      }
      const optionalFields = [
        ['CLOSE_CF_UTM_SOURCE', body.utm_source],
        ['CLOSE_CF_UTM_MEDIUM', body.utm_medium],
        ['CLOSE_CF_UTM_CAMPAIGN', body.utm_campaign],
        ['CLOSE_CF_UTM_CONTENT', body.utm_content],
        ['CLOSE_CF_FBCLID', body.fbclid],
        ['CLOSE_CF_GCLID', body.gclid]
      ]
      for (const [envName, value] of optionalFields) {
        if (value) customFields[process.env[envName]] = value
      }
      if (body.qualified !== undefined) {
        customFields[process.env.CLOSE_CF_QUALIFIED] = body.qualified ? 'Yes' : 'No'
      }
      const { closeLeadId } = await createLead({
        name: body.name,
        email: body.email,
        phone: body.phone ?? null,
        statusId: process.env[statusVar],
        customFields
      })
      await sb.from('leads').update({
        close_lead_id: closeLeadId,
        close_synced_at: new Date().toISOString()
      }).eq('id', leadId)
      return { service: 'close', ok: true }
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
          lead_id: leadId,
          service,
          operation: 'create',
          error_message: String(err?.message || err),
          payload: body
        })
        if (insertErr) console.error('lead_sync_errors insert failed', insertErr)
      } catch (insertErr) {
        console.error('lead_sync_errors insert threw', insertErr)
      }
    }
  }

  return res.status(200).json({ lead_id: leadId })
}
