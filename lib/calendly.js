import crypto from 'node:crypto'

// Parse a Calendly signature header "t=<unix>,v1=<hex>" into parts.
function parseSignatureHeader(header) {
  const parts = {}
  for (const seg of String(header || '').split(',')) {
    const idx = seg.indexOf('=')
    if (idx === -1) continue
    parts[seg.slice(0, idx).trim()] = seg.slice(idx + 1).trim()
  }
  return parts
}

// Verify Calendly's HMAC-SHA256 signature over `${t}.${rawBody}`.
// Replay protection is handled by the calendly_bookings dedup table, so we do
// NOT enforce a timestamp window here — that would reject Calendly's legitimate
// delayed retries (the signature `t` is the original send time).
export function verifySignature(rawBody, signatureHeader, signingKey) {
  if (!signingKey) return false
  const { t, v1 } = parseSignatureHeader(signatureHeader)
  if (!t || !v1) return false
  const expected = crypto
    .createHmac('sha256', signingKey)
    .update(`${t}.${rawBody}`)
    .digest('hex')
  let a, b
  try {
    a = Buffer.from(expected, 'hex')
    b = Buffer.from(v1, 'hex')
  } catch {
    return false
  }
  return a.length === b.length && crypto.timingSafeEqual(a, b)
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
