import { requireAuth } from '../../../lib/auth.js'
import { listLeadStatuses } from '../../../lib/close.js'

// Auth-gated proxy returning the Close lead statuses. The /imessage
// sequences modal uses this to translate trigger_status_id (stat_xxx) into
// human-readable labels in both the list view and the edit dropdown.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' })
  }
  if (!requireAuth(req, res)) return

  try {
    const statuses = await listLeadStatuses()
    // Slim the payload down to what the UI actually uses.
    return res.status(200).json({
      statuses: statuses.map(s => ({ id: s.id, label: s.label }))
    })
  } catch (err) {
    console.error('console/lead-statuses failed', err)
    return res.status(502).json({ error: String(err?.message || err) })
  }
}
