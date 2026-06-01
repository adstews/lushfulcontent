import { describe, it, expect } from 'vitest'
import { normalizePhone } from '../phone.js'

describe('normalizePhone', () => {
  it('keeps E.164 with +', () => expect(normalizePhone('+15550100123')).toBe('+15550100123'))
  it('adds +1 for 10-digit US', () => expect(normalizePhone('5550100123')).toBe('+15550100123'))
  it('adds + for 11-digit leading 1', () => expect(normalizePhone('15550100123')).toBe('+15550100123'))
  it('strips formatting', () => expect(normalizePhone('(555) 010-0123')).toBe('+15550100123'))
  it('returns null for empty', () => expect(normalizePhone('')).toBe(null))
  it('returns null for null', () => expect(normalizePhone(null)).toBe(null))
})
