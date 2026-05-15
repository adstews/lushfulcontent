import { z } from 'zod'
import { sendImessage } from '../../lib/imessage-bridge.js'

const BodySchema = z.object({
  phone: z.string().min(1),
  // At least one of message / mediaUrl must be present — enforced after parse.
  message: z.string().optional().nullable(),
  leadId: z.string().optional().nullable(),
  contactId: z.string().optional().nullable(),
  sendStyle: z.string().optional().nullable(),
  mediaUrl: z.string().url().optional().nullable()
}).refine(
  d => (d.message && d.message.length > 0) || (d.mediaUrl && d.mediaUrl.length > 0),
  { message: 'message or mediaUrl is required' }
)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }

  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      error: 'validation failed',
      details: parsed.error.flatten()
    })
  }
  const body = parsed.data

  try {
    const result = await sendImessage({
      phone: body.phone,
      message: body.message ?? '',
      leadId: body.leadId ?? undefined,
      contactId: body.contactId ?? undefined,
      sendStyle: body.sendStyle ?? undefined,
      mediaUrl: body.mediaUrl ?? undefined
    })
    return res.status(200).json({
      ok: true,
      phone: result.phone,
      messageHandle: result.send?.message_handle ?? null,
      logged: result.log.ok,
      logError: result.log.ok ? null : result.log.error
    })
  } catch (err) {
    console.error('sendblue/send failed', err)
    return res.status(502).json({ error: String(err?.message || err) })
  }
}
