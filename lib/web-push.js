import webpush from 'web-push'
import { getSupabase } from './supabase.js'

function configure() {
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:noreply@lushfulaesthetics.com'
  if (!pub || !priv) throw new Error('VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY not set')
  webpush.setVapidDetails(subject, pub, priv)
}

export function getPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null
}

export async function recordSubscription({ endpoint, p256dh, auth, userAgent }) {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('imessage_console_push_subscriptions')
    .upsert(
      {
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent ?? null,
        last_seen_at: new Date().toISOString(),
        failed_at: null,
        fail_reason: null
      },
      { onConflict: 'endpoint' }
    )
    .select('id')
    .single()
  if (error) throw new Error(`subscribe failed: ${error.message}`)
  return data
}

export async function removeSubscription(endpoint) {
  const sb = getSupabase()
  const { error } = await sb
    .from('imessage_console_push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
  if (error) throw new Error(`unsubscribe failed: ${error.message}`)
}

export async function listActiveSubscriptions() {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('imessage_console_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .is('failed_at', null)
  if (error) throw new Error(`list subs failed: ${error.message}`)
  return data || []
}

// Send a notification to every active subscription. Best-effort: returns
// per-sub results, marks dead ones (404/410) as failed in Supabase. Never throws.
export async function pushToAll(notification) {
  try {
    configure()
  } catch (err) {
    return { ok: false, error: String(err.message), sent: 0 }
  }
  let subs
  try {
    subs = await listActiveSubscriptions()
  } catch (err) {
    return { ok: false, error: String(err.message), sent: 0 }
  }
  if (subs.length === 0) return { ok: true, sent: 0 }

  const sb = getSupabase()
  const payload = JSON.stringify(notification)
  const results = await Promise.allSettled(
    subs.map(s =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload
      )
    )
  )

  let sent = 0
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.status === 'fulfilled') {
      sent++
      continue
    }
    const code = r.reason?.statusCode
    if (code === 404 || code === 410) {
      // Subscription dead — mark it so we stop trying.
      await sb.from('imessage_console_push_subscriptions')
        .update({ failed_at: new Date().toISOString(), fail_reason: `gone:${code}` })
        .eq('id', subs[i].id)
    } else {
      console.error('web-push send error', code, r.reason?.body || r.reason?.message)
    }
  }
  return { ok: true, sent, total: subs.length }
}
