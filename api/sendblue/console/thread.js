import { requireAuth } from '../../../lib/auth.js'
import { getLead } from '../../../lib/close.js'
import { getSupabase } from '../../../lib/supabase.js'

// Returns a single lead's iMessage thread from the Supabase mirror table.
// Joins reactions onto messages by SendBlue message_handle. Also returns
// a replyPhone (most-recent activity phone, else the lead's contact phone).
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' })
  }
  if (!requireAuth(req, res)) return

  const leadId = req.query?.leadId
  if (!leadId || typeof leadId !== 'string') {
    return res.status(400).json({ error: 'leadId required' })
  }

  const sb = getSupabase()
  let messagesData, lead
  try {
    const [msgRes, leadRes] = await Promise.all([
      sb.from('imessage_console_messages')
        .select('id, close_activity_id, direction, message, phone, media_url, sendblue_handle, created_at')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: true })
        .limit(500),
      getLead(leadId)
    ])
    if (msgRes.error) throw new Error(msgRes.error.message)
    messagesData = msgRes.data || []
    lead = leadRes
  } catch (err) {
    console.error('console/thread fetch failed', err)
    return res.status(502).json({ error: String(err?.message || err) })
  }

  // Pull reactions for any messages with a sendblue_handle, then collapse
  // to the latest per (handle, direction) — iMessage allows changing your
  // reaction, and the latest event wins.
  const handles = messagesData
    .map(m => m.sendblue_handle)
    .filter(Boolean)
  let reactionsByHandle = new Map()
  if (handles.length > 0) {
    try {
      const { data, error } = await sb
        .from('imessage_console_reactions')
        .select('message_handle, direction, reaction, removed, created_at')
        .in('message_handle', handles)
        .order('created_at', { ascending: true })
      if (error) throw new Error(error.message)
      for (const r of data || []) {
        let bucket = reactionsByHandle.get(r.message_handle)
        if (!bucket) { bucket = { inbound: null, outbound: null }; reactionsByHandle.set(r.message_handle, bucket) }
        bucket[r.direction] = r.removed ? null : { reaction: r.reaction, at: r.created_at }
      }
    } catch (err) {
      console.error('console/thread reactions lookup failed', err)
    }
  }

  const messages = messagesData.map(m => {
    const bucket = m.sendblue_handle ? reactionsByHandle.get(m.sendblue_handle) : null
    const reactions = []
    if (bucket?.inbound) reactions.push({ direction: 'inbound', ...bucket.inbound })
    if (bucket?.outbound) reactions.push({ direction: 'outbound', ...bucket.outbound })
    return {
      id: m.id,
      closeActivityId: m.close_activity_id,
      sendblueHandle: m.sendblue_handle,
      direction: m.direction,
      message: m.message,
      phone: m.phone,
      mediaUrl: m.media_url,
      at: m.created_at,
      reactions
    }
  })

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
