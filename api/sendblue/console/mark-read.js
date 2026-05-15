import { requireAuth } from '../../../lib/auth.js'
import { getSupabase } from '../../../lib/supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }
  if (!requireAuth(req, res)) return

  const { leadId, at } = req.body || {}
  if (!leadId || typeof leadId !== 'string') {
    return res.status(400).json({ error: 'leadId required' })
  }
  const lastReadAt = at && typeof at === 'string' ? at : new Date().toISOString()

  try {
    const sb = getSupabase()
    const { error } = await sb
      .from('imessage_console_read_state')
      .upsert({ lead_id: leadId, last_read_at: lastReadAt }, { onConflict: 'lead_id' })
    if (error) throw new Error(error.message)
    return res.status(200).json({ ok: true, leadId, lastReadAt })
  } catch (err) {
    console.error('console/mark-read failed', err)
    return res.status(500).json({ error: String(err?.message || err) })
  }
}
