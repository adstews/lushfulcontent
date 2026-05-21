import { describe, it, expect } from 'vitest'
import handler from '../geo.js'

function makeReqRes(headers = {}) {
  const req = { method: 'GET', headers }
  const res = {
    statusCode: 200,
    _json: null,
    status(code) { this.statusCode = code; return this },
    json(obj) { this._json = obj; return this }
  }
  return { req, res }
}

describe('GET /api/geo', () => {
  it('returns 405 for non-GET', async () => {
    const { req, res } = makeReqRes()
    req.method = 'POST'
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })

  it('returns coords from Vercel headers', async () => {
    const { req, res } = makeReqRes({
      'x-vercel-ip-latitude': '40.7589',
      'x-vercel-ip-longitude': '-73.9851',
      'x-vercel-ip-city': 'New%20York',
      'x-vercel-ip-country': 'US'
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json).toEqual({
      lat: 40.7589,
      lng: -73.9851,
      city: 'New York',
      country: 'US'
    })
  })

  it('returns nulls when headers missing', async () => {
    const { req, res } = makeReqRes({})
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json).toEqual({ lat: null, lng: null, city: null, country: null })
  })

  it('returns nulls when headers are unparseable', async () => {
    const { req, res } = makeReqRes({
      'x-vercel-ip-latitude': 'not-a-number',
      'x-vercel-ip-longitude': ''
    })
    await handler(req, res)
    expect(res._json.lat).toBeNull()
    expect(res._json.lng).toBeNull()
  })
})
