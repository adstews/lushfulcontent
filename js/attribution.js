// Attribution capture for Lushful landing pages.
//
// Solves three problems:
//   1. Landers pass UTMs in the URL; CTAs open the form in a new tab with only
//      ?source=…, so utm_* / fbclid / gclid get lost on the form page.
//   2. If the user closes the tab and returns later, the URL params are gone.
//   3. document.referrer and window.location.href on the form page record the
//      form URL, not the real ad-clicked landing page.
//
// Strategy: capture once on landing, persist to localStorage (30-day TTL),
// forward to /girthfill-form* CTAs at click time, merge URL ∪ storage on read
// (URL wins per-field). Last-touch attribution: a fresh ad click overwrites.

(function () {
  var STORAGE_KEY = 'lushful_attribution_v1';
  var TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  var TRACKED_PARAMS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'fbclid', 'gclid'
  ];

  function readUrlParams() {
    var p = new URLSearchParams(window.location.search);
    var out = {};
    TRACKED_PARAMS.forEach(function (k) {
      var v = p.get(k);
      if (v && v.length) out[k] = v;
    });
    return out;
  }

  function readStorage() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (typeof parsed.savedAt !== 'number') return null;
      if (Date.now() - parsed.savedAt > TTL_MS) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function writeStorage(data) {
    try {
      var payload = Object.assign({ savedAt: Date.now() }, data);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      // quota / private mode — swallow
    }
  }

  // Snapshot URL params + referrer + landing_page. Skips when:
  //   - URL has no tracked params (direct/organic visit) — preserves existing storage
  //   - URL params are a subset of (and equal to) what's already stored — we're
  //     downstream of the original landing (e.g. form page reached via CTA
  //     forwarding), so don't overwrite the true landing_page/referrer.
  // Overwrites when a different ad click is detected (any URL param differs
  // from storage's value for that key, or URL adds a key storage doesn't have).
  function captureOnLanding() {
    var urlParams = readUrlParams();
    var keys = Object.keys(urlParams);
    if (keys.length === 0) return;

    var stored = readStorage();
    if (stored) {
      var downstream = keys.every(function (k) {
        return stored[k] === urlParams[k];
      });
      if (downstream) return;
    }

    var snapshot = Object.assign({}, urlParams, {
      referrer: document.referrer || null,
      landing_page: window.location.href
    });
    writeStorage(snapshot);
  }

  // Append tracked params from URL ∪ storage to any link/onclick pointing at
  // /girthfill-form*. Idempotent (skips params already present on the URL).
  function attachToCtas() {
    var url = readUrlParams();
    var stored = readStorage() || {};
    var merged = {};
    TRACKED_PARAMS.forEach(function (k) {
      var v = url[k] || stored[k];
      if (v) merged[k] = v;
    });
    var keys = Object.keys(merged);
    if (keys.length === 0) return;

    function appendToUrl(href) {
      if (!href || href.indexOf('girthfill-form') === -1) return href;
      var u;
      try {
        u = new URL(href, window.location.origin);
      } catch (e) {
        return href;
      }
      keys.forEach(function (k) {
        if (!u.searchParams.has(k)) u.searchParams.set(k, merged[k]);
      });
      // Preserve relative form for same-origin internal links
      var relative = u.pathname + (u.search || '') + (u.hash || '');
      return href.indexOf('://') >= 0 ? u.toString() : relative;
    }

    // <a href="/girthfill-form…">
    document.querySelectorAll('a[href*="girthfill-form"]').forEach(function (a) {
      a.setAttribute('href', appendToUrl(a.getAttribute('href')));
    });

    // <button onclick="window.open('/girthfill-form…','_blank')">
    document.querySelectorAll('button[onclick*="girthfill-form"]').forEach(function (b) {
      var oc = b.getAttribute('onclick');
      if (!oc) return;
      var rewritten = oc.replace(
        /(['"])(\/?girthfill-form[^'"]*)\1/g,
        function (_match, quote, url) {
          return quote + appendToUrl(url) + quote;
        }
      );
      if (rewritten !== oc) b.setAttribute('onclick', rewritten);
    });
  }

  // Read attribution at form-submit time. URL beats storage per-field.
  // referrer / landing_page fall through to current page values when storage
  // is empty, which is the right behavior for direct-to-form visits.
  function getAttribution() {
    var url = readUrlParams();
    var stored = readStorage() || {};
    var out = {};
    TRACKED_PARAMS.forEach(function (k) {
      out[k] = url[k] || stored[k] || null;
    });
    out.referrer = stored.referrer || document.referrer || null;
    out.landing_page = stored.landing_page || window.location.href;
    out.user_agent = navigator.userAgent || null;
    return out;
  }

  // Expose. lushfulAttribution preserved for backward compat with existing
  // inline form-submit code in landers and form pages.
  if (typeof window !== 'undefined') {
    window.lushfulAttribution = getAttribution;
    window.lushfulCaptureOnLanding = captureOnLanding;
    window.lushfulAttachToCtas = attachToCtas;
  }

  // Auto-init on every page that loads this script. Both are safe no-ops on
  // pages without ad params / without matching CTAs.
  function init() {
    captureOnLanding();
    attachToCtas();
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})();
