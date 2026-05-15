import { requireAuth } from '../../../lib/auth.js'
import { recordSubscription, removeSubscription, getPublicKey } from '../../../lib/web-push.js'

export default async function handler(req, res) {
  // GET returns the VAPID public key so the browser can subscribe.
  if (req.method === 'GET') {
    if (!requireAuth(req, res)) return
    const pub = getPublicKey()
    if (!pub) return res.status(500).json({ error: 'VAPID_PUBLIC_KEY not set' })
    return res.status(200).json({ publicKey: pub })
  }

  if (req.method === 'POST') {
    if (!requireAuth(req, res)) return
    const { endpoint, keys, userAgent } = req.body || {}
    if (!endpoint || typeof endpoint !== 'string') {
      return res.status(400).json({ error: 'endpoint required' })
    }
    if (!keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'keys.p256dh and keys.auth required' })
    }
    try {
      const data = await recordSubscription({
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: userAgent || req.headers?.['user-agent'] || null
      })
      return res.status(200).json({ ok: true, id: data?.id })
    } catch (err) {
      console.error('push-subscribe failed', err)
      return res.status(500).json({ error: String(err?.message || err) })
    }
  }

  if (req.method === 'DELETE') {
    if (!requireAuth(req, res)) return
    const endpoint = req.body?.endpoint
    if (!endpoint || typeof endpoint !== 'string') {
      return res.status(400).json({ error: 'endpoint required' })
    }
    try {
      await removeSubscription(endpoint)
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('push-unsubscribe failed', err)
      return res.status(500).json({ error: String(err?.message || err) })
    }
  }

  return res.status(405).json({ error: 'method not allowed' })
}
