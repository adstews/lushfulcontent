import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { verifySignature, parseInviteeCreated } from '../calendly.js'

function sign(raw, key, t = '1700000000') {
  const v1 = crypto.createHmac('sha256', key).update(`${t}.${raw}`).digest('hex')
  return `t=${t},v1=${v1}`
}

describe('verifySignature', () => {
  const key = 'whsec_test'
  const raw = '{"event":"invitee.created"}'

  it('accepts a valid signature', () => {
    expect(verifySignature(raw, sign(raw, key), key)).toBe(true)
  })
  it('rejects a tampered body', () => {
    expect(verifySignature(raw + ' ', sign(raw, key), key)).toBe(false)
  })
  it('rejects a signature made with a different key', () => {
    expect(verifySignature(raw, sign(raw, 'other_key'), key)).toBe(false)
  })
  it('rejects when the signing key is missing', () => {
    expect(verifySignature(raw, sign(raw, key), '')).toBe(false)
  })
  it('rejects a malformed header', () => {
    expect(verifySignature(raw, 'garbage', key)).toBe(false)
    expect(verifySignature(raw, '', key)).toBe(false)
    expect(verifySignature(raw, undefined, key)).toBe(false)
  })
})

describe('parseInviteeCreated', () => {
  const body = {
    event: 'invitee.created',
    payload: {
      name: 'Jane Doe',
      email: 'Jane@Example.com',
      text_reminder_number: '+15551234567',
      timezone: 'America/New_York',
      uri: 'https://api.calendly.com/scheduled_events/EVT/invitees/INV',
      event: 'https://api.calendly.com/scheduled_events/EVT',
      questions_and_answers: [{ question: 'Goal?', answer: 'Bigger', position: 0 }],
      tracking: { utm_source: 'email', utm_campaign: 'reactivation' },
      scheduled_event: { name: '30 Minute Meeting', start_time: '2026-06-03T18:00:00Z' }
    }
  }

  it('extracts core fields and lowercases the email', () => {
    const p = parseInviteeCreated(body)
    expect(p.inviteeUri).toBe('https://api.calendly.com/scheduled_events/EVT/invitees/INV')
    expect(p.eventUri).toBe('https://api.calendly.com/scheduled_events/EVT')
    expect(p.email).toBe('jane@example.com')
    expect(p.name).toBe('Jane Doe')
    expect(p.phone).toBe('+15551234567')
    expect(p.eventName).toBe('30 Minute Meeting')
    expect(p.startTime).toBe('2026-06-03T18:00:00Z')
    expect(p.timezone).toBe('America/New_York')
    expect(p.utm).toEqual({ source: 'email', medium: null, campaign: 'reactivation', content: null, term: null })
    expect(p.questionsAndAnswers).toEqual([{ question: 'Goal?', answer: 'Bigger' }])
  })

  it('falls back to a phone-like Q&A when no text_reminder_number', () => {
    const b = {
      ...body,
      payload: {
        ...body.payload,
        text_reminder_number: null,
        questions_and_answers: [{ question: 'Best phone number', answer: '(555) 000-1111' }]
      }
    }
    expect(parseInviteeCreated(b).phone).toBe('(555) 000-1111')
  })

  it('is null-safe on a sparse payload', () => {
    const p = parseInviteeCreated({ payload: {} })
    expect(p.email).toBeNull()
    expect(p.phone).toBeNull()
    expect(p.questionsAndAnswers).toEqual([])
    expect(p.utm).toEqual({ source: null, medium: null, campaign: null, content: null, term: null })
  })
})
