import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(resolve(__dirname, '../geo-gate.js'), 'utf8')

function makeContext() {
  const win = {}
  const ctx = vm.createContext({ window: win, globalThis: win })
  vm.runInContext(SRC, ctx)
  return win.lushfulGeoGate
}

let G
beforeAll(() => { G = makeContext() })

describe('anchorFromSource', () => {
  it('maps girthfill-sd to sd', () => {
    expect(G.anchorFromSource('girthfill-sd')).toBe('sd')
  })
  it('maps girthfill-nyc to nyc', () => {
    expect(G.anchorFromSource('girthfill-nyc')).toBe('nyc')
  })
  it('maps girthfill-landing to nyc (default lander)', () => {
    expect(G.anchorFromSource('girthfill-landing')).toBe('nyc')
  })
  it('falls back to nyc for unknown/empty', () => {
    expect(G.anchorFromSource('')).toBe('nyc')
    expect(G.anchorFromSource(null)).toBe('nyc')
    expect(G.anchorFromSource('something-else')).toBe('nyc')
  })
})

describe('extractAreaCode', () => {
  it('parses common US formats', () => {
    expect(G.extractAreaCode('(212) 555-1234')).toBe('212')
    expect(G.extractAreaCode('212-555-1234')).toBe('212')
    expect(G.extractAreaCode('212.555.1234')).toBe('212')
    expect(G.extractAreaCode('2125551234')).toBe('212')
  })
  it('strips leading country code 1', () => {
    expect(G.extractAreaCode('+1 (212) 555-1234')).toBe('212')
    expect(G.extractAreaCode('12125551234')).toBe('212')
  })
  it('returns null for too-short numbers', () => {
    expect(G.extractAreaCode('555-1234')).toBeNull()
    expect(G.extractAreaCode('')).toBeNull()
    expect(G.extractAreaCode(null)).toBeNull()
  })
  it('returns null for non-US country codes', () => {
    expect(G.extractAreaCode('+44 20 7946 0958')).toBeNull()
    expect(G.extractAreaCode('+52 55 1234 5678')).toBeNull()
  })
})

describe('haversineMiles', () => {
  it('returns 0 for identical points', () => {
    expect(G.haversineMiles([40, -74], [40, -74])).toBeCloseTo(0, 5)
  })
  it('computes NYC to LA roughly (~2450mi)', () => {
    const d = G.haversineMiles([40.7589, -73.9851], [34.0522, -118.2437])
    expect(d).toBeGreaterThan(2400)
    expect(d).toBeLessThan(2500)
  })
  it('computes NYC to Philly roughly (~80mi)', () => {
    const d = G.haversineMiles([40.7589, -73.9851], [39.9526, -75.1652])
    expect(d).toBeGreaterThan(70)
    expect(d).toBeLessThan(95)
  })
})

describe('evaluateGate', () => {
  const NYC_IP = [40.7589, -73.9851]
  const LA_IP = [34.0522, -118.2437]
  const SD_IP = [32.7157, -117.1611]

  it("returns 'local' when phone area code is in NYC allowlist", () => {
    expect(G.evaluateGate({ phone: '212-555-1234', ipCoords: LA_IP, anchorKey: 'nyc' })).toBe('local')
  })
  it("returns 'local' when phone area code is in SD allowlist", () => {
    expect(G.evaluateGate({ phone: '619-555-1234', ipCoords: NYC_IP, anchorKey: 'sd' })).toBe('local')
  })
  it("returns 'local' when IP is within 100mi (phone non-local)", () => {
    expect(G.evaluateGate({ phone: '415-555-1234', ipCoords: NYC_IP, anchorKey: 'nyc' })).toBe('local')
    expect(G.evaluateGate({ phone: '212-555-1234', ipCoords: SD_IP, anchorKey: 'sd' })).toBe('local')
  })
  it("returns 'show-step' when both signals out of range", () => {
    expect(G.evaluateGate({ phone: '415-555-1234', ipCoords: LA_IP, anchorKey: 'nyc' })).toBe('show-step')
  })
  it("returns 'show-step' when phone non-local and IP unavailable", () => {
    expect(G.evaluateGate({ phone: '415-555-1234', ipCoords: null, anchorKey: 'nyc' })).toBe('show-step')
    expect(G.evaluateGate({ phone: '415-555-1234', ipCoords: { lat: null, lng: null }, anchorKey: 'nyc' })).toBe('show-step')
  })
  it("returns 'show-step' when both signals unavailable", () => {
    expect(G.evaluateGate({ phone: '', ipCoords: null, anchorKey: 'nyc' })).toBe('show-step')
  })
  it("ignores NYC area codes when anchor is SD", () => {
    expect(G.evaluateGate({ phone: '212-555-1234', ipCoords: LA_IP, anchorKey: 'sd' })).toBe('show-step')
  })
})
