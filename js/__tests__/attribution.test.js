// Browser unit test for js/attribution.js. Runs the IIFE inside a vm context
// where we stub window/document/localStorage/navigator. Each scenario gets a
// fresh context so storage and DOM state don't leak between tests.

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(resolve(__dirname, '../attribution.js'), 'utf8')

function makeFakeStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    clear: () => { map.clear() },
    _dump: () => Object.fromEntries(map)
  }
}

function makeFakeDocument({ readyState = 'complete', referrer = '', elements = [] } = {}) {
  // Minimal querySelectorAll: returns elements that match by checking the
  // explicit `tagAndOnclick`/`tagAndHref` markers we set on each fake element.
  return {
    readyState,
    referrer,
    _elements: elements,
    addEventListener: () => {},
    querySelectorAll: (sel) => {
      return elements.filter((el) => {
        if (sel === 'a[href*="girthfill-form"]') {
          return el._tag === 'a' && (el.getAttribute('href') || '').indexOf('girthfill-form') >= 0
        }
        if (sel === 'button[onclick*="girthfill-form"]') {
          return el._tag === 'button' && (el.getAttribute('onclick') || '').indexOf('girthfill-form') >= 0
        }
        return []
      })
    }
  }
}

function makeFakeElement(tag, attrs) {
  const a = Object.assign({}, attrs)
  return {
    _tag: tag,
    getAttribute: (name) => (name in a ? a[name] : null),
    setAttribute: (name, value) => { a[name] = value }
  }
}

function runAttribution({
  search = '',
  href = 'https://lushfulcontent.vercel.app/girthfill-nyc',
  referrer = '',
  readyState = 'complete',
  storage = null,
  elements = [],
  now = Date.now(),
  userAgent = 'Mozilla/5.0 (test)'
} = {}) {
  const localStorage = makeFakeStorage()
  if (storage) localStorage.setItem('lushful_attribution_v1', JSON.stringify(storage))

  const url = new URL(href)
  if (search) url.search = search.startsWith('?') ? search.slice(1) : search

  const fakeWindow = {
    location: { search: url.search, href: url.toString(), origin: url.origin },
    localStorage
  }
  const fakeDocument = makeFakeDocument({ readyState, referrer, elements })
  const fakeNavigator = { userAgent }

  const context = vm.createContext({
    window: fakeWindow,
    document: fakeDocument,
    navigator: fakeNavigator,
    localStorage,
    URLSearchParams,
    URL,
    Date: class extends Date {
      static now() { return now }
    }
  })
  // Mirror window globals so non-prefixed reads work (e.g. document.referrer).
  context.location = fakeWindow.location

  vm.runInContext(SRC, context)

  return { window: fakeWindow, document: fakeDocument, localStorage, elements }
}

describe('attribution.js', () => {
  it('captures URL params to localStorage on landing', () => {
    const { localStorage } = runAttribution({
      search: '?utm_source=meta&utm_campaign=spring&fbclid=abc',
      href: 'https://lushfulcontent.vercel.app/girthfill-nyc?utm_source=meta&utm_campaign=spring&fbclid=abc',
      referrer: 'https://www.facebook.com/'
    })
    const stored = JSON.parse(localStorage.getItem('lushful_attribution_v1'))
    expect(stored.utm_source).toBe('meta')
    expect(stored.utm_campaign).toBe('spring')
    expect(stored.fbclid).toBe('abc')
    expect(stored.referrer).toBe('https://www.facebook.com/')
    expect(stored.landing_page).toContain('girthfill-nyc')
    expect(typeof stored.savedAt).toBe('number')
  })

  it('does NOT clobber storage when URL has no tracked params (direct revisit)', () => {
    const priorSaved = {
      utm_source: 'meta',
      referrer: 'https://www.facebook.com/',
      landing_page: 'https://lushfulcontent.vercel.app/girthfill-nyc?utm_source=meta',
      savedAt: Date.now() - 1000
    }
    const { localStorage } = runAttribution({
      search: '',
      storage: priorSaved
    })
    const stored = JSON.parse(localStorage.getItem('lushful_attribution_v1'))
    expect(stored.utm_source).toBe('meta')
    expect(stored.savedAt).toBe(priorSaved.savedAt)
  })

  it('getAttribution merges URL ∪ storage when downstream (forwarded subset of stored params)', () => {
    const { window, localStorage } = runAttribution({
      // Form page reached via CTA forwarding: URL has the subset that fits in
      // the link, storage has the full lander context.
      search: '?utm_source=meta&utm_campaign=spring',
      storage: {
        utm_source: 'meta',
        utm_medium: 'cpc',
        utm_campaign: 'spring',
        referrer: 'https://www.facebook.com/',
        landing_page: 'https://lushfulcontent.vercel.app/girthfill-nyc?utm_source=meta&utm_medium=cpc&utm_campaign=spring',
        savedAt: Date.now() - 1000
      }
    })
    const attr = window.lushfulAttribution()
    expect(attr.utm_source).toBe('meta')
    expect(attr.utm_campaign).toBe('spring')
    // Storage fills the gap for fields not present on the form URL
    expect(attr.utm_medium).toBe('cpc')
    // Storage preserved (not overwritten by form-page values)
    expect(attr.referrer).toBe('https://www.facebook.com/')
    expect(attr.landing_page).toContain('girthfill-nyc')
    // And storage itself wasn't clobbered with form-page context
    const stillStored = JSON.parse(localStorage.getItem('lushful_attribution_v1'))
    expect(stillStored.referrer).toBe('https://www.facebook.com/')
    expect(stillStored.landing_page).toContain('girthfill-nyc')
  })

  it('overwrites storage on a different ad click (URL UTMs differ from storage)', () => {
    const { localStorage } = runAttribution({
      search: '?utm_source=google&gclid=newgclid',
      href: 'https://lushfulcontent.vercel.app/girthfill-sd?utm_source=google&gclid=newgclid',
      storage: {
        utm_source: 'meta',
        utm_medium: 'cpc',
        utm_campaign: 'old_camp',
        referrer: 'https://www.facebook.com/',
        landing_page: 'https://lushfulcontent.vercel.app/girthfill-nyc?utm_source=meta',
        savedAt: Date.now() - 1000
      }
    })
    const stored = JSON.parse(localStorage.getItem('lushful_attribution_v1'))
    // New ad — storage replaced wholesale
    expect(stored.utm_source).toBe('google')
    expect(stored.gclid).toBe('newgclid')
    expect(stored.utm_medium).toBeUndefined()
    expect(stored.utm_campaign).toBeUndefined()
    expect(stored.landing_page).toContain('girthfill-sd')
  })

  it('ignores expired storage (>30 days)', () => {
    const now = 1_700_000_000_000
    const thirtyOneDays = 31 * 24 * 60 * 60 * 1000
    const { window } = runAttribution({
      search: '',
      now,
      storage: {
        utm_source: 'old_meta',
        savedAt: now - thirtyOneDays
      }
    })
    const attr = window.lushfulAttribution()
    expect(attr.utm_source).toBeNull()
  })

  it('rewrites <a href> CTAs to forward UTM params from URL', () => {
    const link = makeFakeElement('a', { href: '/girthfill-form?source=girthfill-nyc' })
    runAttribution({
      search: '?utm_source=meta&utm_campaign=spring&fbclid=abc&irrelevant=skip',
      elements: [link]
    })
    const rewritten = link.getAttribute('href')
    expect(rewritten).toContain('source=girthfill-nyc')
    expect(rewritten).toContain('utm_source=meta')
    expect(rewritten).toContain('utm_campaign=spring')
    expect(rewritten).toContain('fbclid=abc')
    expect(rewritten).not.toContain('irrelevant')
  })

  it('rewrites button onclick="window.open(...)" CTAs', () => {
    const btn = makeFakeElement('button', {
      onclick: "window.open('/girthfill-form?source=girthfill-nyc','_blank')"
    })
    runAttribution({
      search: '?utm_source=meta&gclid=xyz',
      elements: [btn]
    })
    const rewritten = btn.getAttribute('onclick')
    expect(rewritten).toContain('utm_source=meta')
    expect(rewritten).toContain('gclid=xyz')
    expect(rewritten).toContain("'_blank'")
  })

  it('attachToCtas pulls from storage when URL is empty (cross-tab / revisit)', () => {
    const link = makeFakeElement('a', { href: '/girthfill-form?source=girthfill-nyc' })
    runAttribution({
      search: '',
      storage: {
        utm_source: 'meta_stored',
        savedAt: Date.now() - 1000
      },
      elements: [link]
    })
    expect(link.getAttribute('href')).toContain('utm_source=meta_stored')
  })

  it('does not duplicate a param already on the CTA href', () => {
    const link = makeFakeElement('a', { href: '/girthfill-form?source=girthfill-nyc&utm_source=organic' })
    runAttribution({
      search: '?utm_source=meta',
      elements: [link]
    })
    const rewritten = link.getAttribute('href')
    expect(rewritten.match(/utm_source=/g).length).toBe(1)
    // existing value wins
    expect(rewritten).toContain('utm_source=organic')
  })
})
