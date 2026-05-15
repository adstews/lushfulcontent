import { requireAuth } from '../../../lib/auth.js'
import {
  enrollLead, pauseEnrollment, resumeEnrollment, unenrollEnrollment,
  listEnrollmentsForLead
} from '../../../lib/sequences.js'

// /api/sendblue/console/enrollments
//   GET  ?leadId=...                       — list a lead's enrollments
//   POST { sequenceId, leadId, phone? }    — manually enroll a lead
//   POST ?action=pause&id=<enrollment_id>     — pause an enrollment
//   POST ?action=resume&id=<enrollment_id>    — resume a paused enrollment
//   POST ?action=unenroll&id=<enrollment_id>  — remove an enrollment
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return

  if (req.method === 'GET') {
    const leadId = req.query?.leadId
    if (!leadId) return res.status(400).json({ error: 'leadId required' })
    try {
      const enrollments = await listEnrollmentsForLead(leadId)
      return res.status(200).json({ enrollments })
    } catch (err) {
      console.error('enrollments GET failed', err)
      return res.status(500).json({ error: String(err?.message || err) })
    }
  }

  if (req.method === 'POST') {
    const action = req.query?.action
    const id = req.query?.id

    if (action === 'pause') {
      if (!id) return res.status(400).json({ error: 'id required' })
      try { await pauseEnrollment(id, 'manual'); return res.status(200).json({ ok: true }) }
      catch (err) { return res.status(500).json({ error: String(err?.message || err) }) }
    }
    if (action === 'resume') {
      if (!id) return res.status(400).json({ error: 'id required' })
      try { await resumeEnrollment(id); return res.status(200).json({ ok: true }) }
      catch (err) { return res.status(500).json({ error: String(err?.message || err) }) }
    }
    if (action === 'unenroll') {
      if (!id) return res.status(400).json({ error: 'id required' })
      try { await unenrollEnrollment(id, 'manual'); return res.status(200).json({ ok: true }) }
      catch (err) { return res.status(500).json({ error: String(err?.message || err) }) }
    }

    // Default POST: create a new enrollment
    const { sequenceId, leadId, phone, contactId } = req.body || {}
    if (!sequenceId) return res.status(400).json({ error: 'sequenceId required' })
    if (!leadId) return res.status(400).json({ error: 'leadId required' })
    try {
      const enrollment = await enrollLead({ sequenceId, leadId, phone, contactId })
      return res.status(200).json(enrollment)
    } catch (err) {
      console.error('enrollments POST failed', err)
      return res.status(500).json({ error: String(err?.message || err) })
    }
  }

  return res.status(405).json({ error: 'method not allowed' })
}
