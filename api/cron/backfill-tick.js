import { sendImessage } from '../../lib/imessage-bridge.js'
import { sendMessage } from '../../lib/imessage-provider.js'
import { isSuppressed } from '../../lib/opt-outs.js'
import { tryReserveNewConversation } from '../../lib/new-convo-throttle.js'
import { getSupabase } from '../../lib/supabase.js'

// Daily GirthFill re-engagement backfill. Vercel Cron hits this once a day
// (vercel.json: 11am ET). It drains imessage_backfill_queue newest-first,
// sends a fixed batch, and texts the founder a recap. It NEVER queries Close —
// the queue is a frozen roster, so post-freeze leads can never get pulled in.

const BATCH = parseInt(process.env.BACKFILL_DAILY_BATCH || '8', 10)
// Backfill new-conversations share the same daily cap as organic leads so we
// never blow past Blooio's shared-plan limit.
const CAP = parseInt(process.env.IMESSAGE_NEW_CONVO_DAILY_CAP || '14', 10)
// The founder's number for the daily recap text. Overridable via env.
const OWNER_PHONE = process.env.BACKFILL_REPORT_PHONE || '+14754778884'
const MESSAGE = "Hi there, it's the team at Lushful Aesthetics — you reached out about GirthFill " +
  "a while back and we didn't want to leave your questions unanswered. If you're still curious " +
  "whether it's a fit, book a free confidential consult here: https://start.lushfulaesthetics.com/consultation-book"

// Same belt-and-suspenders cron auth as sequence-tick.
function verifyCron(req) {
  const auth = req.headers?.authorization
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (process.env.CRON_SECRET && auth === expected) return true
  if (req.headers?.['x-vercel-cron'] === '1') return true
  return false
}

// Recap to the founder via the raw provider (no Close activity / console mirror,
// so the owner's own thread doesn't get spammed). Never throws.
async function notifyOwner(text) {
  if (!OWNER_PHONE) return
  try {
    await sendMessage({ phone: OWNER_PHONE, message: text })
  } catch (err) {
    console.error('backfill-tick: owner notify failed', err)
  }
}

async function countRemaining(sb) {
  const { count } = await sb
    .from('imessage_backfill_queue')
    .select('id', { count: 'exact', head: true })
    .is('sent_at', null)
  return count || 0
}

export default async function handler(req, res) {
  if (!verifyCron(req)) {
    return res.status(401).json({ error: 'unauthorized cron call' })
  }

  const dry = req.query?.dry === '1'
  const sb = getSupabase()
  const now = new Date()

  // Pull the next batch, newest-first, still-queued only.
  const { data: queue, error } = await sb
    .from('imessage_backfill_queue')
    .select('id, position, close_lead_id, phone, name')
    .is('sent_at', null)
    .order('position', { ascending: true })
    .limit(BATCH)
  if (error) {
    console.error('backfill-tick: queue read failed', error)
    return res.status(500).json({ error: error.message })
  }

  if (!queue || queue.length === 0) {
    if (!dry) {
      await notifyOwner('✅ Lushful GirthFill backfill complete — every queued lead has been contacted. You can turn the daily job off.')
    }
    return res.status(200).json({ ok: true, done: true, sent: 0, remaining: 0 })
  }

  if (dry) {
    return res.status(200).json({
      ok: true,
      dry: true,
      wouldSend: queue.map(q => ({ name: q.name, phone: q.phone })),
      remaining: await countRemaining(sb)
    })
  }

  const sent = []
  const skippedOptout = []
  const failed = []
  let capHit = false

  for (const row of queue) {
    // STOP / opt-out guard — drop from the queue without sending.
    if (await isSuppressed({ phone: row.phone, leadId: row.close_lead_id })) {
      await sb.from('imessage_backfill_queue')
        .update({ sent_at: now.toISOString(), status: 'skipped_optout' })
        .eq('id', row.id)
      skippedOptout.push(row)
      continue
    }

    // Reserve a shared daily-cap slot; if the cap is exhausted, stop and leave
    // the rest queued for tomorrow.
    const reservation = await tryReserveNewConversation(row.phone, CAP, now)
    if (!reservation.ok) {
      capHit = true
      break
    }

    try {
      const result = await sendImessage({
        phone: row.phone,
        message: MESSAGE,
        leadId: row.close_lead_id,
        leadName: row.name
      })
      await sb.from('imessage_backfill_queue')
        .update({ sent_at: now.toISOString(), status: 'sent', message_handle: result?.send?.message_handle ?? null })
        .eq('id', row.id)
      sent.push(row)
    } catch (err) {
      console.error(`backfill-tick: send failed for ${row.phone}`, err)
      // One attempt, then mark failed so it doesn't block the queue head.
      await sb.from('imessage_backfill_queue')
        .update({ sent_at: now.toISOString(), status: 'failed' })
        .eq('id', row.id)
      failed.push({ phone: row.phone, error: String(err?.message || err) })
    }
  }

  const remaining = await countRemaining(sb)

  const parts = [`Lushful backfill: texted ${sent.length} today`]
  if (skippedOptout.length) parts.push(`${skippedOptout.length} skipped (opted out)`)
  if (failed.length) parts.push(`${failed.length} failed`)
  if (capHit) parts.push('paused early (daily cap)')
  parts.push(`${remaining} left (~${Math.ceil(remaining / BATCH)} days)`)
  await notifyOwner(parts.join(' · '))

  return res.status(200).json({
    ok: true,
    sent: sent.length,
    skippedOptout: skippedOptout.length,
    failed: failed.length,
    capHit,
    remaining
  })
}
