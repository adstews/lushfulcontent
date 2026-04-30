// Returns the current page's attribution context as a flat object.
// Safe to call multiple times; reads from window.location each call.
window.lushfulAttribution = function getAttribution() {
  var params = new URLSearchParams(window.location.search);
  var pick = function (key) {
    var v = params.get(key);
    return v && v.length ? v : null;
  };
  return {
    utm_source:   pick('utm_source'),
    utm_medium:   pick('utm_medium'),
    utm_campaign: pick('utm_campaign'),
    utm_content:  pick('utm_content'),
    utm_term:     pick('utm_term'),
    fbclid:       pick('fbclid'),
    gclid:        pick('gclid'),
    referrer:     document.referrer || null,
    landing_page: window.location.href,
    user_agent:   navigator.userAgent || null
  };
};
