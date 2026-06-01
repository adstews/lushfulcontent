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
