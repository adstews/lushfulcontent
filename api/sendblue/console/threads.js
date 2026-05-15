import { requireAuth } from '../../../lib/auth.js'
import { listCustomActivities } from '../../../lib/close.js'

// Returns a list of conversation threads (one per lead) sorted by most
// recent iMessage activity. Pulls the latest N activities and groups by lead.
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
    // 200 activities is enough to fill the inbox for now; bump later if needed.
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

    const existing = byLead.get(leadId)
    if (!existing || (at && existing.lastAt && at > existing.lastAt) || (at && !existing.lastAt)) {
      byLead.set(leadId, {
        leadId,
        leadName: a.lead_display_name || a.contact_name || null,
        lastMessage: message || (a.note || null),
        lastDirection: direction,
        lastPhone: phone,
        lastAt: at
      })
    }
  }

  const threads = [...byLead.values()].sort((a, b) => {
    if (!a.lastAt) return 1
    if (!b.lastAt) return -1
    return a.lastAt < b.lastAt ? 1 : -1
  })

  return res.status(200).json({ threads, count: threads.length })
}
