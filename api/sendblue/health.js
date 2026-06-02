import { checkAuth as sendblueCheckAuth } from '../../lib/sendblue.js'
import { checkAuth as blooioCheckAuth } from '../../lib/blooio.js'
import { getMe } from '../../lib/close.js'

export default async function handler(req, res) {
  const useBlooio = process.env.IMESSAGE_PROVIDER !== 'sendblue'
  const imessageService = useBlooio ? 'blooio' : 'sendblue'
  const imessageCheck = useBlooio ? blooioCheckAuth : sendblueCheckAuth

  const results = await Promise.allSettled([
    imessageCheck().then(() => ({ service: imessageService, ok: true })),
    getMe().then(() => ({ service: 'close', ok: true }))
  ])

  const checks = results.map((r, i) => {
    const service = i === 0 ? imessageService : 'close'
    if (r.status === 'fulfilled') return { service, ok: true }
    return { service, ok: false, error: String(r.reason?.message || r.reason) }
  })

  const envCheck = {
    SENDBLUE_API_KEY: !!process.env.SENDBLUE_API_KEY,
    SENDBLUE_API_SECRET: !!process.env.SENDBLUE_API_SECRET,
    CLOSE_API_KEY: !!process.env.CLOSE_API_KEY,
    CLOSE_CUSTOM_ACTIVITY_IMESSAGE: !!process.env.CLOSE_CUSTOM_ACTIVITY_IMESSAGE,
    SENDBLUE_WEBHOOK_SECRET: !!process.env.SENDBLUE_WEBHOOK_SECRET,
    BLOOIO_API_KEY: !!process.env.BLOOIO_API_KEY,
    BLOOIO_WEBHOOK_SIGNING_SECRET: !!process.env.BLOOIO_WEBHOOK_SIGNING_SECRET
  }

  const allOk = checks.every(c => c.ok)
  return res.status(allOk ? 200 : 503).json({
    ok: allOk,
    checks,
    env: envCheck
  })
}
