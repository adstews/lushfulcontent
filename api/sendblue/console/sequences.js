import { requireAuth } from '../../../lib/auth.js'
import {
  listSequences, getSequence, createSequence, updateSequence, deleteSequence
} from '../../../lib/sequences.js'

// /api/sendblue/console/sequences           — GET list, POST create
// /api/sendblue/console/sequences?id=<uuid> — GET one, PATCH update, DELETE
//
// Combining into one file because Vercel doesn't auto-create dynamic routes
// (e.g. [id].js) the same way Next.js does for plain serverless functions.
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return

  const id = req.query?.id

  if (req.method === 'GET') {
    try {
      if (id) {
        const seq = await getSequence(id)
        return res.status(200).json(seq)
      }
      const seqs = await listSequences()
      return res.status(200).json({ sequences: seqs })
    } catch (err) {
      console.error('sequences GET failed', err)
      return res.status(500).json({ error: String(err?.message || err) })
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {}
    if (!body.name || typeof body.name !== 'string') {
      return res.status(400).json({ error: 'name required' })
    }
    try {
      const seq = await createSequence(body)
      return res.status(200).json(seq)
    } catch (err) {
      console.error('sequences POST failed', err)
      return res.status(500).json({ error: String(err?.message || err) })
    }
  }

  if (req.method === 'PATCH' || req.method === 'PUT') {
    if (!id) return res.status(400).json({ error: 'id query param required' })
    try {
      const seq = await updateSequence(id, req.body || {})
      return res.status(200).json(seq)
    } catch (err) {
      console.error('sequences PATCH failed', err)
      return res.status(500).json({ error: String(err?.message || err) })
    }
  }

  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'id query param required' })
    try {
      await deleteSequence(id)
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('sequences DELETE failed', err)
      return res.status(500).json({ error: String(err?.message || err) })
    }
  }

  return res.status(405).json({ error: 'method not allowed' })
}
