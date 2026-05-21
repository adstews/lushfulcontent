// api/geo.js
// Reads visitor location from Vercel's automatic IP-geo headers and returns
// it as JSON. No external dependency — Vercel attaches these headers to
// every serverless function request based on its own GeoIP DB.
// https://vercel.com/docs/edge-network/headers#x-vercel-ip-*
function parseFloatOrNull(v) {
  if (typeof v !== 'string' || v.length === 0) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function decodeOrNull(v) {
  if (typeof v !== 'string' || v.length === 0) return null
  try { return decodeURIComponent(v) } catch { return v }
}

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' })
  }
  const h = req.headers || {}
  return res.status(200).json({
    lat: parseFloatOrNull(h['x-vercel-ip-latitude']),
    lng: parseFloatOrNull(h['x-vercel-ip-longitude']),
    city: decodeOrNull(h['x-vercel-ip-city']),
    country: decodeOrNull(h['x-vercel-ip-country'])
  })
}
