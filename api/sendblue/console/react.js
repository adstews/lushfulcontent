import { requireAuth } from '../../../lib/auth.js'
import { sendReaction } from '../../../lib/sendblue.js'
import { getSupabase } from '../../../lib/supabase.js'

const VALID_REACTIONS = new Set([
  'love', 'like', 'dislike', 'laugh', 'emphasize', 'question',
  '-love', '-like', '-dislike', '-laugh', '-emphasize', '-question'
])

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireAuth(req, res)) return

  const { messageHandle, phone, reaction, leadId } = req.body || {}
  if (!messageHandle) return res.status(400).json({ error: 'messageHandle required' })
  if (!phone) return res.status(400).json({ error: 'phone required' })
  if (!reaction || !VALID_REACTIONS.has(reaction)) {
    return res.status(400).json({ error: 'invalid reaction (use love/like/dislike/laugh/emphasize/question, prefix with - to remove)' })
  }

  try {
    await sendReaction({ phone, messageHandle, reaction })
  } catch (err) {
    console.error('console/react send failed', err)
    return res.status(502).json({ error: String(err?.message || err) })
  }

  // Persist our reaction so the thread view can show it without waiting
  // for SendBlue to echo it back.
  try {
    const sb = getSupabase()
    const removed = reaction.startsWith('-')
    await sb.from('imessage_console_reactions').insert({
      message_handle: messageHandle,
      lead_id: leadId || null,
      direction: 'outbound',
      reaction: removed ? reaction.slice(1) : reaction,
      removed
    })
  } catch (err) {
    console.error('console/react persist failed', err)
    // Don't fail the request — the send worked, persistence is best-effort.
  }

  return res.status(200).json({ ok: true })
}
