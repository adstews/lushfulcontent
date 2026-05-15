import { requireAuth } from '../../../lib/auth.js'
import { getSupabase } from '../../../lib/supabase.js'

// Inbox: one row per lead, sorted by most recent iMessage. Includes
// unreadCount (inbound messages newer than our last_read_at).
// Reads from the imessage_console_messages mirror table (not Close), because
// Close's /activity/custom/ requires a lead_id filter and can't list across
// the workspace.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' })
  }
  if (!requireAuth(req, res)) return

  const sb = getSupabase()

  // Pull recent messages; group client-side. 1000 rows is well within
  // Supabase's free-tier read budget and covers months of activity.
  let messages
  try {
    const { data, error } = await sb
      .from('imessage_console_messages')
      .select('lead_id, lead_name, direction, message, phone, created_at')
      .order('created_at', { ascending: false })
      .limit(1000)
    if (error) throw new Error(error.message)
    messages = data || []
  } catch (err) {
    console.error('console/threads supabase read failed', err)
    return res.status(500).json({ error: String(err?.message || err) })
  }

  const byLead = new Map()
  for (const m of messages) {
    const leadId = m.lead_id
    if (!leadId) continue
    let entry = byLead.get(leadId)
    if (!entry) {
      entry = {
        leadId,
        leadName: m.lead_name || null,
        lastMessage: m.message,
        lastDirection: m.direction,
        lastPhone: m.phone,
        lastAt: m.created_at,
        inboundAts: []
      }
      byLead.set(leadId, entry)
    } else if (!entry.leadName && m.lead_name) {
      entry.leadName = m.lead_name
    }
    if (m.direction === 'inbound' && m.created_at) {
      entry.inboundAts.push(m.created_at)
    }
  }

  // Look up read state for matching leads.
  const leadIds = [...byLead.keys()]
  const readMap = new Map()
  if (leadIds.length > 0) {
    try {
      const { data, error } = await sb
        .from('imessage_console_read_state')
        .select('lead_id, last_read_at')
        .in('lead_id', leadIds)
      if (error) throw new Error(error.message)
      for (const row of data || []) readMap.set(row.lead_id, row.last_read_at)
    } catch (err) {
      console.error('console/threads read state lookup failed', err)
    }
  }

  const threads = [...byLead.values()].map(t => {
    const lastReadAt = readMap.get(t.leadId) || null
    const unreadCount = lastReadAt
      ? t.inboundAts.filter(at => at > lastReadAt).length
      : t.inboundAts.length
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
