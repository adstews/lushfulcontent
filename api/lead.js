import { z } from 'zod'
import { getSupabase } from '../lib/supabase.js'
import { upsertSubscriber, addTags } from '../lib/mailchimp.js'
import { createLead } from '../lib/close.js'

const BodySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().nullable().optional(),
  source: z.enum(['girthfill-landing', 'girthfill-carousel']),
  utm_source: z.string().optional().nullable(),
  utm_medium: z.string().optional().nullable(),
  utm_campaign: z.string().optional().nullable(),
  utm_content: z.string().optional().nullable(),
  utm_term: z.string().optional().nullable(),
  fbclid: z.string().optional().nullable(),
  gclid: z.string().optional().nullable(),
  referrer: z.string().optional().nullable(),
  landing_page: z.string().optional().nullable(),
  user_agent: z.string().optional().nullable()
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
  const { data: leadRow, error: upsertErr } = await sb
    .from('leads')
    .upsert({
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
    }, {
      onConflict: 'email,source'
    })
    .select('id')
    .single()

  if (upsertErr) {
    console.error('supabase upsert failed', upsertErr)
    return res.status(500).json({ error: 'failed to save lead' })
  }
  const leadId = leadRow.id

  // 2. Best-effort fanout
  const tag = body.source === 'girthfill-carousel'
    ? 'girthfill-carousel'
    : 'girthfill-landing'

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
      await addTags({ email: body.email, tags: [tag] })
      await sb.from('leads').update({
        mailchimp_subscriber_hash: subscriberHash,
        mailchimp_synced_at: new Date().toISOString()
      }).eq('id', leadId)
      return { service: 'mailchimp', ok: true }
    })
  ]

  if (body.source === 'girthfill-landing') {
    tasks.push(taggedTask('close', async () => {
      const requiredCloseEnvVars = [
        'CLOSE_STATUS_NEW',
        'CLOSE_CF_SOURCE',
        'CLOSE_CF_UTM_SOURCE',
        'CLOSE_CF_UTM_MEDIUM',
        'CLOSE_CF_UTM_CAMPAIGN',
        'CLOSE_CF_UTM_CONTENT',
        'CLOSE_CF_FBCLID',
        'CLOSE_CF_GCLID'
      ]
      const missingVars = requiredCloseEnvVars.filter(v => !process.env[v])
      if (missingVars.length > 0) {
        throw new Error(`Close env vars missing: ${missingVars.join(', ')}`)
      }
      const customFields = {
        [process.env.CLOSE_CF_SOURCE]: body.source,
        [process.env.CLOSE_CF_UTM_SOURCE]: body.utm_source ?? '',
        [process.env.CLOSE_CF_UTM_MEDIUM]: body.utm_medium ?? '',
        [process.env.CLOSE_CF_UTM_CAMPAIGN]: body.utm_campaign ?? '',
        [process.env.CLOSE_CF_UTM_CONTENT]: body.utm_content ?? '',
        [process.env.CLOSE_CF_FBCLID]: body.fbclid ?? '',
        [process.env.CLOSE_CF_GCLID]: body.gclid ?? ''
      }
      const { closeLeadId } = await createLead({
        name: body.name,
        email: body.email,
        phone: body.phone ?? null,
        statusId: process.env.CLOSE_STATUS_NEW,
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
