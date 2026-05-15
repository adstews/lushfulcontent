import { requireAuth } from '../../../lib/auth.js'
import { listCustomActivities } from '../../../lib/close.js'
import { getSupabase } from '../../../lib/supabase.js'

// Returns a list of conversation threads (one per lead) sorted by most
// recent iMessage activity. Pulls the latest N activities and groups by lead.
// Includes per-thread unreadCount: inbound messages with date_created after
// our locally tracked last_read_at for that lead.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' })
  }
  if (!requireAuth(req, res)) return

  const activityTypeId = process.env.CLOSE_CUSTOM_ACTIVITY_IMESSAGE
  if (!activityTypeId) {
    return res.status(500).json({ error: 'CLOSE_CUSTOM_ACTIVITY_IMESSAGE not set' })
  }
  const textCfId = process.env.CLOSE_CF_IMESSAGE_TEXT
  const dirCfId = process.env.CLOSE_CF_IMESSAGE_DIRECTION
  const phoneCfId = process.env.CLOSE_CF_IMESSAGE_PHONE

  let result
  try {
    result = await listCustomActivities({ activityTypeId, limit: 200 })
  } catch (err) {
    console.error('console/threads list failed', err)
    return res.status(502).json({ error: String(err?.message || err) })
  }

  const activities = Array.isArray(result?.data) ? result.data : []
  const byLead = new Map()
  for (const a of activities) {
    const leadId = a.lead_id
    if (!leadId) continue
    const message = textCfId ? a[`custom.${textCfId}`] : null
    const direction = dirCfId ? a[`custom.${dirCfId}`] : null
    const phone = phoneCfId ? a[`custom.${phoneCfId}`] : null
    const at = a.date_created || a.created_at || null

    let entry = byLead.get(leadId)
    if (!entry) {
      entry = {
        leadId,
        leadName: a.lead_display_name || a.contact_name || null,
        lastMessage: null,
        lastDirection: null,
        lastPhone: null,
        lastAt: null,
        inbound: []
      }
      byLead.set(leadId, entry)
    }
    if (direction === 'inbound' && at) {
      entry.inbound.push(at)
    }
    if (at && (!entry.lastAt || at > entry.lastAt)) {
      entry.lastMessage = message || (a.note || null)
      entry.lastDirection = direction
      entry.lastPhone = phone
      entry.lastAt = at
      if (!entry.leadName) entry.leadName = a.lead_display_name || a.contact_name || null
    }
  }

  const leadIds = [...byLead.keys()]
  let readMap = new Map()
  if (leadIds.length > 0) {
    try {
      const sb = getSupabase()
      const { data, error } = await sb
        .from('imessage_console_read_state')
        .select('lead_id, last_read_at')
        .in('lead_id', leadIds)
      if (error) throw new Error(error.message)
      for (const row of data || []) readMap.set(row.lead_id, row.last_read_at)
    } catch (err) {
      // Don't fail the inbox if read-state lookup breaks — just report 0 unread.
      console.error('console/threads read state lookup failed', err)
    }
  }

  const threads = [...byLead.values()].map(t => {
    const lastReadAt = readMap.get(t.leadId) || null
    const unreadCount = lastReadAt
      ? t.inbound.filter(at => at > lastReadAt).length
      : t.inbound.length
    return {
      leadId: t.leadId,
      leadName: t.leadName,
      lastMessage: t.lastMessage,
      lastDirection: t.lastDirection,
      lastPhone: t.lastPhone,
      lastAt: t.lastAt,
      unreadCount,
      lastReadAt
    }
  })

  threads.sort((a, b) => {
    if (!a.lastAt) return 1
    if (!b.lastAt) return -1
    return a.lastAt < b.lastAt ? 1 : -1
  })

  return res.status(200).json({ threads, count: threads.length })
}
