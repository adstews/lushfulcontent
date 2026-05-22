// js/geo-gate.js
// Travel-gate helpers for girthfill-form. Decides whether a visitor likely
// lives near the lander's anchor city (NYC or SD) using their phone area
// code first, then their IP-derived coordinates. The form module reads the
// result and either skips or shows the stepTravel confirmation step.
//
// Browser-only: attaches window.lushfulGeoGate. Tested via Node vm context.
(function () {
  var ANCHORS = {
    nyc: {
      coords: [40.7589, -73.9851],
      areaCodes: new Set([
        // NYC core
        '212', '332', '646', '718', '917', '347', '929',
        // NY suburbs (Long Island, Westchester, Hudson Valley)
        '516', '631', '914', '845',
        // Northern + central NJ + South Jersey
        '201', '551', '973', '862', '732', '848', '908', '609', '856',
        // Southwest CT
        '203', '475',
        // Eastern PA (Philly metro + Lehigh Valley)
        '215', '267', '445', '610', '484'
      ])
    },
    sd: {
      coords: [32.7157, -117.1611],
      extraCoords: [34.0522, -118.2437],
      areaCodes: new Set([
        // SD core
        '619', '858',
        // SD County (north + east), Inland Empire, Orange County
        '760', '951', '949', '714',
        // LA metro
        '213', '310', '323', '424', '562', '626', '657', '661',
        '747', '818', '909', '949'
      ])
    }
  }

  // Anchor selection mirrors the existing allowlist in girthfill-form.html:
  // ['girthfill-landing', 'girthfill-nyc', 'girthfill-sd']. Direct hits to
  // /girthfill-form (with no ?source=) become 'girthfill-landing' which
  // defaults to NYC, matching the recent / default-NYC commit.
  function anchorFromSource(source) {
    if (source === 'girthfill-sd') return 'sd'
    return 'nyc'
  }

  // Returns first NANP area code from a phone string, or null. Strips the
  // optional leading 1 (US country code) but explicitly rejects non-US
  // country codes (+44, +52, etc.) by requiring either no + or +1.
  function extractAreaCode(phone) {
    if (typeof phone !== 'string' || phone.length === 0) return null
    var trimmed = phone.trim()
    var hasIntlPrefix = trimmed.charAt(0) === '+'
    var digits = trimmed.replace(/\D/g, '')
    if (hasIntlPrefix) {
      // Only accept +1 (NANP). Anything else (+44, +52, ...) is not US.
      if (digits.charAt(0) !== '1') return null
      digits = digits.slice(1)
    } else if (digits.length === 11 && digits.charAt(0) === '1') {
      // 11-digit with leading 1, no plus: 12125551234 → strip the 1.
      digits = digits.slice(1)
    }
    if (digits.length < 10) return null
    return digits.slice(0, 3)
  }

  // Great-circle distance in miles between two [lat, lng] pairs.
  function haversineMiles(a, b) {
    var R = 3958.7613 // Earth radius in miles
    var toRad = function (d) { return d * Math.PI / 180 }
    var dLat = toRad(b[0] - a[0])
    var dLng = toRad(b[1] - a[1])
    var lat1 = toRad(a[0])
    var lat2 = toRad(b[0])
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2)
    return 2 * R * Math.asin(Math.sqrt(h))
  }

  // Accepts either [lat, lng] tuple or {lat, lng} object; returns tuple or null.
  function normalizeCoords(c) {
    if (!c) return null
    if (Array.isArray(c) && c.length === 2 && typeof c[0] === 'number' && typeof c[1] === 'number') return c
    if (typeof c === 'object' && typeof c.lat === 'number' && typeof c.lng === 'number') return [c.lat, c.lng]
    return null
  }

  // Three-signal cascade. Returns 'local' if phone OR IP indicate the
  // visitor is in-area; 'show-step' otherwise (including when both signals
  // are missing — the conservative default is to ask).
  function evaluateGate(opts) {
    var anchor = ANCHORS[opts.anchorKey]
    if (!anchor) return 'show-step'

    var npa = extractAreaCode(opts.phone)
    if (npa && anchor.areaCodes.has(npa)) return 'local'

    var ip = normalizeCoords(opts.ipCoords)
    if (ip) {
      if (haversineMiles(ip, anchor.coords) < 100) return 'local'
      if (anchor.extraCoords && haversineMiles(ip, anchor.extraCoords) < 100) return 'local'
    }

    return 'show-step'
  }

  window.lushfulGeoGate = {
    ANCHORS: ANCHORS,
    anchorFromSource: anchorFromSource,
    extractAreaCode: extractAreaCode,
    haversineMiles: haversineMiles,
    evaluateGate: evaluateGate
  }
})()
