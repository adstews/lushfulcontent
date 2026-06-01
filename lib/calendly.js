import crypto from 'node:crypto'

// Constant-time string compare; false on length mismatch.
function timingSafeEq(a, b) {
  const ab = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

// Verify the shared secret on a Calendly webhook request. Calendly does not
// issue a signing key or send custom headers for this account, so the secret
// rides in the callback URL's query string (?secret=...); we also accept an
// X-Webhook-Secret header. Mirrors api/sendblue/close-webhook.js. Fails closed
// when the expected secret is unset — we never accept unverified writes.
export function verifySecret(req, expected) {
  if (!expected) return false
  const header = req.headers && (req.headers['x-webhook-secret'] || req.headers['X-Webhook-Secret'])
  if (header && timingSafeEq(header, expected)) return true
  try {
    const url = new URL(req.url, 'http://localhost')
    const q = url.searchParams.get('secret')
    if (q && timingSafeEq(q, expected)) return true
  } catch { /* malformed url */ }
  return false
}

// Normalize a Calendly invitee.created webhook body into the fields we use.
export function parseInviteeCreated(body) {
  const p = (body && body.payload) || {}
  const sched = p.scheduled_event || {}
  const qa = Array.isArray(p.questions_and_answers) ? p.questions_and_answers : []
  const tracking = p.tracking || {}

  let phone = p.text_reminder_number || null
  if (!phone) {
    const phoneQa = qa.find(x => /phone|mobile|cell/i.test((x && x.question) || ''))
    phone = (phoneQa && phoneQa.answer) || null
  }

  return {
    inviteeUri: p.uri || null,
    eventUri: p.event || sched.uri || null,
    name: p.name || null,
    email: (p.email || '').trim().toLowerCase() || null,
    phone,
    timezone: p.timezone || null,
    eventName: sched.name || null,
    startTime: sched.start_time || null,
    questionsAndAnswers: qa.map(x => ({ question: x.question, answer: x.answer })),
    utm: {
      source: tracking.utm_source || null,
      medium: tracking.utm_medium || null,
      campaign: tracking.utm_campaign || null,
      content: tracking.utm_content || null,
      term: tracking.utm_term || null
    }
  }
}
