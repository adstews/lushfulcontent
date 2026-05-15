import { requireAuth } from '../../../lib/auth.js'

// Search Close leads for the compose UI. Pass `?q=<text>` — matches name,
// email, or phone via Close's standard query DSL. Returns up to 20.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' })
  }
  if (!requireAuth(req, res)) return

  const q = (req.query?.q || '').trim()
  if (!q) {
    return res.status(200).json({ leads: [], count: 0 })
  }

  const apiKey = process.env.CLOSE_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'CLOSE_API_KEY not set' })

  const auth = 'Basic ' + Buffer.from(apiKey + ':').toString('base64')
  // Close's URL DSL handles fuzzy matching across name/email/phone for free-text.
  const url = `https://api.close.com/api/v1/lead/?query=${encodeURIComponent(q)}&_limit=20&_fields=id,display_name,contacts,status_label`
  let result
  try {
    const r = await fetch(url, { method: 'GET', headers: { Authorization: auth } })
    if (!r.ok) {
      const text = await r.text()
      return res.status(502).json({ error: `Close search failed: ${r.status} ${text}` })
    }
    result = await r.json()
  } catch (err) {
    return res.status(502).json({ error: String(err?.message || err) })
  }

  const leads = (result?.data || []).map(l => {
    const contact = (l.contacts || [])[0] || null
    const phone = contact?.phones?.[0]?.phone || null
    return {
      leadId: l.id,
      leadName: l.display_name,
      statusLabel: l.status_label,
      phone,
      contactId: contact?.id || null
    }
  })

  return res.status(200).json({ leads, count: leads.length })
}
