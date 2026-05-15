import { requireAuth } from '../../../lib/auth.js'
import { listCustomActivities, getLead } from '../../../lib/close.js'

// Returns a single lead's iMessage thread (all inbound + outbound activities,
// chronological) along with the lead's name + a phone to reply on.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' })
  }
  if (!requireAuth(req, res)) return

  const leadId = req.query?.leadId
  if (!leadId || typeof leadId !== 'string') {
    return res.status(400).json({ error: 'leadId required' })
  }

  const activityTypeId = process.env.CLOSE_CUSTOM_ACTIVITY_IMESSAGE
  if (!activityTypeId) {
    return res.status(500).json({ error: 'CLOSE_CUSTOM_ACTIVITY_IMESSAGE not set' })
  }
  const textCfId = process.env.CLOSE_CF_IMESSAGE_TEXT
  const dirCfId = process.env.CLOSE_CF_IMESSAGE_DIRECTION
  const phoneCfId = process.env.CLOSE_CF_IMESSAGE_PHONE

  let listResult, lead
  try {
    [listResult, lead] = await Promise.all([
      listCustomActivities({ activityTypeId, leadId, limit: 200 }),
      getLead(leadId)
    ])
  } catch (err) {
    console.error('console/thread fetch failed', err)
    return res.status(502).json({ error: String(err?.message || err) })
  }

  const activities = Array.isArray(listResult?.data) ? listResult.data : []
  const messages = activities
    .map(a => ({
      id: a.id,
      direction: dirCfId ? a[`custom.${dirCfId}`] : null,
      message: textCfId ? a[`custom.${textCfId}`] : (a.note || null),
      phone: phoneCfId ? a[`custom.${phoneCfId}`] : null,
      at: a.date_created || a.created_at || null
    }))
    .sort((a, b) => {
      if (!a.at) return 1
      if (!b.at) return -1
      return a.at < b.at ? -1 : 1
    })

  // Pick a phone we can reply on: prefer the most recent phone we logged,
  // else the lead's first contact phone.
  let replyPhone = null
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].phone) { replyPhone = messages[i].phone; break }
  }
  if (!replyPhone) {
    const contact = (lead?.contacts || [])[0]
    const phoneObj = contact?.phones?.[0]
    if (phoneObj?.phone) replyPhone = phoneObj.phone
  }

  return res.status(200).json({
    leadId,
    leadName: lead?.display_name || null,
    statusLabel: lead?.status_label || null,
    replyPhone,
    messages
  })
}
