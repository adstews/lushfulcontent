import crypto from 'node:crypto'

// Verify an HMAC-SHA256 signature header of the form "t=<unix>,v1=<hex>" over
// `${t}.${rawBody}`. Rejects signatures older than 5 minutes (replay guard).
export function verifyHmacSignature(rawBody, signatureHeader, secret, maxAgeSec = 300) {
  if (!secret || !signatureHeader) return false
  const parts = {}
  for (const seg of String(signatureHeader).split(',')) {
    const i = seg.indexOf('=')
    if (i !== -1) parts[seg.slice(0, i).trim()] = seg.slice(i + 1).trim()
  }
  const { t, v1 } = parts
  if (!t || !v1) return false
  const age = Math.floor(Date.now() / 1000) - parseInt(t, 10)
  if (!Number.isFinite(age) || age > maxAgeSec || age < -maxAgeSec) return false
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  let a, b
  try { a = Buffer.from(expected, 'hex'); b = Buffer.from(v1, 'hex') } catch { return false }
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// Buffer the raw request body (needed because the HMAC is over exact bytes).
// Honors req.rawBody if the platform exposes it; route must set bodyParser:false.
export function readRawBody(req) {
  if (req.rawBody) return Promise.resolve(typeof req.rawBody === 'string' ? req.rawBody : req.rawBody.toString('utf8'))
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(typeof c === 'string' ? Buffer.from(c) : c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
