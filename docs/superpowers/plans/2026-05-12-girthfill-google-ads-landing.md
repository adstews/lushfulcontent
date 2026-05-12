# GirthFill Google Ads Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a contact-first Google Ads landing funnel for GirthFill (NYC). Net-new files alongside the existing Meta funnel. One small API change, two new hand-built HTML files, and a manual E2E verification pass.

**Architecture:** Two new HTML files (`girthfill-nyc-google.html` + `girthfill-form-google.html`) that share the existing API (`/api/lead`, `/api/lead-update`) via a widened `source` enum. Contact info captured at Step 1 (creates Close lead as Potential). Qualifier asked at Step 2 (flips Close status to Qualified or Bad Fit). Step 3 branches to Boulevard booking widget (yes) or IG/YouTube follow buttons (no). Two Google Ads conversion actions and two Meta Pixel events fire at the two-tier capture points.

**Tech Stack:** Vanilla HTML/CSS/JS (no framework), Vercel serverless JS functions, Zod validation, Vitest tests, Supabase, Mailchimp, Close CRM. Repo at `~/Claude/lushfulcontent/`.

**Spec:** `docs/superpowers/specs/2026-05-12-girthfill-google-ads-landing-design.md`

---

## File Map

**Create:**
- `girthfill-nyc-google.html` (landing page, ~600 lines)
- `girthfill-form-google.html` (form page, ~400 lines)

**Modify:**
- `api/lead.js:10` (widen `source` enum by 2 values)
- `api/__tests__/lead.test.js` (add cases for new source values)

**No changes:**
- `api/lead-update.js` (existing schema supports new flow as-is)
- `lib/*.js`, Supabase schema, Mailchimp merge fields, Close custom fields
- Existing `girthfill-nyc.html`, `girthfill-sd.html`, `girthfill-form.html`, `index.html`

---

## Task 1: Widen `source` Enum (TDD)

**Files:**
- Modify: `api/lead.js:10`
- Modify: `api/__tests__/lead.test.js` (append new test cases)

**Context for the engineer:** the existing `api/lead.js` validates incoming `source` against a Zod enum. We need to add two new values: `'girthfill-nyc-google'` and `'girthfill-sd-google'`. The rest of the handler's logic (Close status mapping, Mailchimp tagging) already handles new source values transparently because it uses `body.source` directly as the Mailchimp tag and only branches on `body.source !== 'girthfill-carousel'` for the Close fanout gate.

- [ ] **Step 1: Add failing tests**

Open `api/__tests__/lead.test.js`. Find the existing `describe('POST /api/lead', () => {` block and append the following two tests **inside** that describe block (before its closing `})`):

```javascript
it('accepts source = girthfill-nyc-google and tags Mailchimp with that source', async () => {
  mockSupabase({
    upsertResult: { data: { id: 'lead-uuid' }, error: null }
  })
  upsertSubscriber.mockResolvedValue({ subscriberHash: 'hash123' })
  addTags.mockResolvedValue()
  createLead.mockResolvedValue({ closeLeadId: 'close_lead_xyz' })

  const { req, res } = makeReqRes({
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '555-0100',
    source: 'girthfill-nyc-google'
  })
  await handler(req, res)

  expect(res.statusCode).toBe(200)
  expect(addTags).toHaveBeenCalledWith({
    email: 'jane@example.com',
    tags: ['girthfill-nyc-google', 'SQ Lander']
  })
  // Step 1 contact submit does NOT send qualified, so Close should
  // be created with the NEW (Potential) status.
  expect(createLead).toHaveBeenCalledWith(
    expect.objectContaining({
      statusId: 'stat_new'
    })
  )
})

it('accepts source = girthfill-sd-google', async () => {
  mockSupabase({
    upsertResult: { data: { id: 'lead-uuid' }, error: null }
  })
  upsertSubscriber.mockResolvedValue({ subscriberHash: 'hash123' })
  addTags.mockResolvedValue()
  createLead.mockResolvedValue({ closeLeadId: 'close_lead_xyz' })

  const { req, res } = makeReqRes({
    name: 'John Smith',
    email: 'john@example.com',
    phone: '555-0200',
    source: 'girthfill-sd-google'
  })
  await handler(req, res)

  expect(res.statusCode).toBe(200)
  expect(addTags).toHaveBeenCalledWith({
    email: 'john@example.com',
    tags: ['girthfill-sd-google', 'SQ Lander']
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/Claude/lushfulcontent && npm test
```

Expected output: tests fail with Zod validation error mentioning `source` enum (the new values aren't allowed yet).

- [ ] **Step 3: Widen the enum**

Open `api/lead.js`. Find line 10:

```javascript
source: z.enum(['girthfill-landing', 'girthfill-carousel', 'girthfill-nyc', 'girthfill-sd']),
```

Replace with:

```javascript
source: z.enum([
  'girthfill-landing',
  'girthfill-carousel',
  'girthfill-nyc',
  'girthfill-sd',
  'girthfill-nyc-google',
  'girthfill-sd-google'
]),
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
cd ~/Claude/lushfulcontent && npm test
```

Expected: all 27 tests pass (25 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
cd ~/Claude/lushfulcontent && git add api/lead.js api/__tests__/lead.test.js && git commit -m "$(cat <<'EOF'
feat: widen lead source enum for Google Ads funnel

Adds 'girthfill-nyc-google' and 'girthfill-sd-google' to the /api/lead
source enum so the upcoming Google-Ads landing pages can identify
themselves in Supabase, Mailchimp tags, and Close CRM custom fields.

No behavior changes for existing sources. Mailchimp tagging uses
body.source directly, so new sources get their own segmentable tag
automatically. Close fanout gate (!== 'girthfill-carousel') flows new
sources to Close transparently.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Build `girthfill-form-google.html`

**Files:**
- Create: `girthfill-form-google.html`

**Context for the engineer:** This is the new contact-first qualification form. It mirrors the visual style of `girthfill-form.html` (dark body, white centered card, Playfair headers + Inter body) but inverts the step order (contact first, then qualifier) and adds a social-follow exit for disqualified leads. Two Google Ads conversions fire at the two-tier capture points. The form file is hand-written (no framework, no build step) — Vercel serves it as a static asset at `/girthfill-form-google` thanks to `cleanUrls: true` in `vercel.json`.

- [ ] **Step 1: Create the file with full content**

Create `~/Claude/lushfulcontent/girthfill-form-google.html` with the following content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Request More Info | GirthFill by Lushful Aesthetics</title>

<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-PSX5GNZ');</script>
<!-- End Google Tag Manager -->

<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '24843507025240186');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=24843507025240186&ev=PageView&noscript=1"
/></noscript>
<!-- End Meta Pixel Code -->

<!-- Google Ads (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=AW-11150884432"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'AW-11150884432');

  // Existing "Qualified Lead" conversion — fires at Step 2 qualified=yes
  function gtag_report_qualified_lead() {
    gtag('event', 'conversion', {
      'send_to': 'AW-11150884432/o557CJi-86UcEND8k8Up'
    });
    return false;
  }

  // NEW "Lead Submission" conversion — fires at Step 1 contact submit
  // LAUNCH PREREQ: create conversion action in Google Ads UI (Tools →
  // Conversions → New), copy the label string (the part after "/"),
  // and replace LEAD_SUBMISSION_LABEL below with the real label.
  function gtag_report_lead_submission() {
    gtag('event', 'conversion', {
      'send_to': 'AW-11150884432/LEAD_SUBMISSION_LABEL'
    });
    return false;
  }
</script>

<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --dark: #1E2A21;
    --dark-brown: #3B3230;
    --cream: #F5F0EB;
    --warm-white: #FAF8F5;
    --accent: #C4A882;
    --accent-dark: #A88B6A;
    --text: #2C2826;
    --text-light: #6B6560;
    --border: #E8E2DB;
  }

  body {
    font-family: 'Inter', -apple-system, sans-serif;
    color: var(--text);
    background: var(--dark);
    -webkit-font-smoothing: antialiased;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
  }

  .form-logo {
    font-family: 'Playfair Display', serif;
    color: #fff;
    font-size: 22px;
    font-weight: 500;
    letter-spacing: 0.5px;
    margin-bottom: 32px;
    text-align: center;
  }

  .form-card {
    background: #fff;
    border-radius: 20px;
    width: 100%;
    max-width: 520px;
    padding: 48px 40px;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    animation: fadeUp 0.4s ease;
  }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .progress-bar {
    display: flex;
    gap: 8px;
    justify-content: center;
    margin-bottom: 36px;
  }
  .progress-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--border);
    transition: background 0.3s;
  }
  .progress-dot.active { background: var(--dark); }

  .form-step { display: none; }
  .form-step.active { display: block; animation: fadeUp 0.35s ease; }

  .form-step h2 {
    font-family: 'Playfair Display', serif;
    font-size: 28px;
    font-weight: 500;
    margin-bottom: 16px;
    color: var(--dark);
  }
  .form-step p {
    font-size: 15px;
    color: var(--text-light);
    line-height: 1.65;
    margin-bottom: 24px;
  }
  .highlight {
    font-size: 17px;
    font-weight: 600;
    color: var(--dark);
    margin-bottom: 4px;
  }

  .btn-group {
    display: flex;
    gap: 12px;
    justify-content: center;
    margin-top: 8px;
  }
  .btn-yes, .btn-no {
    padding: 15px 44px;
    border-radius: 50px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: all 0.2s;
    font-family: 'Inter', sans-serif;
  }
  .btn-yes { background: var(--dark); color: #fff; }
  .btn-yes:hover { background: #2a3a2d; }
  .btn-no { background: var(--cream); color: var(--text); }
  .btn-no:hover { background: #ebe5de; }

  .form-input {
    width: 100%;
    padding: 16px 18px;
    border: 1.5px solid var(--border);
    border-radius: 12px;
    font-size: 15px;
    font-family: 'Inter', sans-serif;
    margin-bottom: 16px;
    outline: none;
    transition: border-color 0.2s;
    background: var(--warm-white);
  }
  .form-input:focus { border-color: var(--dark); background: #fff; }

  .form-submit {
    width: 100%;
    padding: 16px;
    background: var(--dark);
    color: #fff;
    border: none;
    border-radius: 50px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    margin-top: 8px;
    transition: background 0.2s;
    font-family: 'Inter', sans-serif;
  }
  .form-submit:hover { background: #2a3a2d; }

  .option-btn {
    display: block;
    width: 100%;
    padding: 16px;
    background: var(--dark);
    color: #fff;
    border: none;
    border-radius: 50px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    margin-top: 0;
    text-decoration: none;
    text-align: center;
    transition: background 0.2s;
    font-family: 'Inter', sans-serif;
  }
  .option-btn:hover { background: #2a3a2d; }
  .option-note {
    font-size: 13px;
    color: var(--text-light);
    margin: 10px 0 22px;
    line-height: 1.4;
  }
  .option-note:last-of-type { margin-bottom: 8px; }
  .call-btn {
    display: block;
    padding: 14px 16px;
    background: var(--cream);
    color: var(--text);
    border-radius: 12px;
    text-decoration: none;
    font-size: 14px;
    font-weight: 500;
    text-align: center;
    margin-top: 12px;
    line-height: 1.5;
    transition: background 0.2s;
  }
  .call-btn:hover { background: #ebe5de; }
  .call-btn strong { color: var(--dark); }

  /* Social-path buttons (Step 3b) */
  .social-btn {
    display: block;
    width: 100%;
    padding: 16px;
    border-radius: 50px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    text-align: center;
    margin-top: 12px;
    color: #fff;
    transition: opacity 0.2s, transform 0.2s;
    font-family: 'Inter', sans-serif;
  }
  .social-btn:hover { opacity: 0.92; transform: translateY(-1px); }
  .social-btn.ig {
    background: linear-gradient(135deg, #833ab4 0%, #fd1d1d 50%, #fcb045 100%);
  }
  .social-btn.yt { background: #ff0000; }

  .disqualified { color: var(--text-light); }
  .disqualified h2 { margin-bottom: 12px; color: var(--dark); }
  .disqualified p { margin-bottom: 20px; }

  .form-footer {
    margin-top: 24px;
    text-align: center;
    color: rgba(255,255,255,0.35);
    font-size: 12px;
  }
  .form-footer a {
    color: rgba(255,255,255,0.5);
    text-decoration: none;
  }
  .form-footer a:hover { text-decoration: underline; }

  .step-label {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--text-light);
    margin-bottom: 20px;
    font-weight: 500;
  }

  .consent-line {
    font-size: 0.75rem;
    color: var(--text-light);
    text-align: center;
    margin-top: 0.75rem;
    line-height: 1.4;
  }

  @media (max-width: 600px) {
    .form-card { padding: 36px 24px; }
    .form-step h2 { font-size: 24px; }
    .btn-group { flex-direction: column; }
    .btn-yes, .btn-no { width: 100%; }
  }
</style>
<script src="/js/attribution.js"></script>
</head>
<body>
<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-PSX5GNZ"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->

<div class="form-logo">Lushful Aesthetics</div>

<div class="form-card">

  <!-- STEP 1: Contact info (active first) -->
  <div class="form-step active" id="stepContact">
    <div class="progress-bar">
      <div class="progress-dot active"></div>
      <div class="progress-dot"></div>
    </div>
    <div class="step-label">Step 1 of 2</div>
    <h2>Tell Us About Yourself</h2>
    <p>We'll use this to reach out about your consultation.</p>
    <input type="text" class="form-input" placeholder="First Name" id="formFirstName" autocomplete="given-name">
    <input type="text" class="form-input" placeholder="Last Name" id="formLastName" autocomplete="family-name">
    <input type="email" class="form-input" placeholder="Email Address" id="formEmail" autocomplete="email">
    <input type="tel" class="form-input" placeholder="Phone Number" id="formPhone" autocomplete="tel">
    <div id="formError" style="color: #c44; font-size: 0.85rem; min-height: 1.2em; margin-bottom: 0.5rem;"></div>
    <button class="form-submit" onclick="submitContact(event)">Continue</button>
    <p class="consent-line">By submitting you agree to receive occasional emails from Lushful Aesthetics. Unsubscribe anytime.</p>
  </div>

  <!-- STEP 2: $8,500 qualifier -->
  <div class="form-step" id="stepQualify">
    <div class="progress-bar">
      <div class="progress-dot active"></div>
      <div class="progress-dot active"></div>
    </div>
    <div class="step-label">Step 2 of 2</div>
    <h2>Before We Begin</h2>
    <p class="highlight">GirthFill is not covered by insurance.</p>
    <p>Treatments start at <strong>$8,500 for 10 syringes</strong> and typically add <strong>1-2 inches of girth</strong>. Financing is available through Cherry.</p>
    <p style="margin-bottom: 32px; font-weight: 600; color: var(--dark);">Are you still interested?</p>
    <div class="btn-group">
      <button class="btn-yes" onclick="answerQualification(true)">Yes, I'm Interested</button>
      <button class="btn-no" onclick="answerQualification(false)">Not Right Now</button>
    </div>
  </div>

  <!-- STEP 3a: Yes path (book options) -->
  <div class="form-step" id="stepOptions">
    <h2>Great! Here are your options:</h2>
    <p style="margin-bottom: 28px;">Choose the next step that works best for you.</p>

    <a href="https://www.joinblvd.com/b/lushful-aesthetics/widget#/locations"
       class="option-btn" target="_blank" rel="noopener"
       onclick="recordCta('book')">Book An Appointment</a>
    <p class="option-note">$1,000 Deposit, applied to procedure</p>

    <a href="tel:+19172773398" class="call-btn"
       onclick="recordCta('tap-to-call')">
      You can also call our office to discuss details.<br>
      <strong>(917) 277-3398</strong>
    </a>
  </div>

  <!-- STEP 3b: No path (social follow + homepage) -->
  <div class="form-step disqualified" id="stepSocial">
    <h2>Stay In Touch</h2>
    <p>GirthFill might not be right for you today &mdash; and that's okay. Follow us for results and educational content. If anything changes, we'd love to hear from you.</p>
    <a href="https://www.instagram.com/lushfulaesthetics/"
       class="social-btn ig" target="_blank" rel="noopener">Follow on Instagram</a>
    <a href="https://www.youtube.com/channel/UCh6HankCyOK9CgsS-uvTjGg/"
       class="social-btn yt" target="_blank" rel="noopener">Subscribe on YouTube</a>
    <a href="https://lushfulaesthetics.com" class="option-btn" style="margin-top: 16px;">Visit Our Homepage</a>
  </div>

</div>

<div class="form-footer">
  <p>&copy; 2026 Lushful Aesthetics &bull; <a href="https://lushfulaesthetics.com">lushfulaesthetics.com</a></p>
</div>

<script>
  function showStep(id) {
    document.querySelectorAll('.form-step').forEach(function (s) {
      s.classList.remove('active');
    });
    document.getElementById(id).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showError(msg) {
    var el = document.getElementById('formError');
    if (el) el.textContent = msg;
  }

  async function submitContact(event) {
    event.preventDefault();
    var firstName = document.getElementById('formFirstName').value.trim();
    var lastName  = document.getElementById('formLastName').value.trim();
    var email     = document.getElementById('formEmail').value.trim();
    var phone     = document.getElementById('formPhone').value.trim();
    if (!firstName || !lastName || !email || !phone) {
      showError('Please fill in all fields.');
      return;
    }
    var name = (firstName + ' ' + lastName).trim();

    var btn = document.querySelector('#stepContact button.form-submit');
    var originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    try {
      var attribution = window.lushfulAttribution ? window.lushfulAttribution() : {};
      var allowedSources = ['girthfill-nyc-google', 'girthfill-sd-google'];
      var sourceParam = new URLSearchParams(window.location.search).get('source');
      var source = allowedSources.indexOf(sourceParam) >= 0 ? sourceParam : 'girthfill-nyc-google';
      var body = Object.assign(
        { name: name, email: email, phone: phone, source: source },
        attribution
      );
      var res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error('lead-post-failed:' + res.status);
      var data = await res.json();
      window.__leadId = data.lead_id;
      if (typeof gtag_report_lead_submission === 'function') gtag_report_lead_submission();
      if (typeof fbq === 'function') fbq('track', 'Lead');
      showStep('stepQualify');
    } catch (err) {
      console.error('lead capture failed', err);
      showError('Something went wrong. Please try again.');
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  function answerQualification(qualified) {
    var btns = document.querySelectorAll('#stepQualify button');
    btns.forEach(function (b) { b.disabled = true; });

    // Fire-and-forget update to /api/lead-update; UI advances immediately
    fetch('/api/lead-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_id: window.__leadId,
        qualified: qualified
      })
    }).catch(function () { /* swallow */ });

    if (qualified) {
      if (typeof gtag_report_qualified_lead === 'function') gtag_report_qualified_lead();
      if (typeof fbq === 'function') fbq('track', 'CompleteRegistration');
      showStep('stepOptions');
    } else {
      showStep('stepSocial');
    }
  }

  function recordCta(kind) {
    fetch('/api/lead-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_id: window.__leadId,
        cta_clicked: kind
      })
    }).catch(function () { /* swallow */ });
  }
</script>

</body>
</html>
```

- [ ] **Step 2: Verify file loads in dev server**

```bash
cd ~/Claude/lushfulcontent && npm run dev
```

Then in a browser, visit `http://localhost:3000/girthfill-form-google?source=girthfill-nyc-google`. Expected: form loads with Step 1 (Tell Us About Yourself) visible. Inputs work. No console errors.

Kill the dev server (Ctrl-C).

- [ ] **Step 3: Commit**

```bash
cd ~/Claude/lushfulcontent && git add girthfill-form-google.html && git commit -m "$(cat <<'EOF'
feat: add girthfill-form-google.html (contact-first qualification form)

New form for the Google Ads funnel. Inverts the existing qualifier-first
flow: contact info captured at Step 1 (creates Close lead as Potential),
qualifier asked at Step 2 (flips Close status to Qualified or Bad Fit),
Step 3 branches to Boulevard booking widget (yes) or IG/YouTube follow
buttons (no).

Two Google Ads conversions wired:
- gtag_report_lead_submission() at Step 1 (LEAD_SUBMISSION_LABEL is a
  placeholder; must be replaced with the real conversion label before
  launch — see docs/superpowers/specs/2026-05-12-girthfill-google-ads-landing-design.md
  "Launch Prerequisites")
- gtag_report_qualified_lead() at Step 2 yes (existing
  AW-11150884432/o557CJi-86UcEND8k8Up)

Meta Pixel mirrored: Lead at Step 1, CompleteRegistration at Step 2 yes.

Source resolution from ?source= query param against allowlist
['girthfill-nyc-google', 'girthfill-sd-google'], default
girthfill-nyc-google. Single form file serves both NYC and (later) SD.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Build `girthfill-nyc-google.html`

**Files:**
- Create: `girthfill-nyc-google.html`

**Context for the engineer:** This is the Google-Ads NYC landing page. It models the structure of `https://lushfulaesthetics.com/lushful-aesthetics-signup` but adds the hero video from the existing `girthfill-nyc.html`, keeps our trust bar and press logos (high converters), drops the SD office card (NYC only), and trims FAQ to top 5. All CTAs link to `/girthfill-form-google?source=girthfill-nyc-google` opened in a new tab.

- [ ] **Step 1: Create the file with full content**

Create `~/Claude/lushfulcontent/girthfill-nyc-google.html` with the following content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>What is GirthFill? Non-Surgical Penile Girth Enhancement in NYC | Lushful Aesthetics</title>

<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-PSX5GNZ');</script>
<!-- End Google Tag Manager -->

<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '24843507025240186');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=24843507025240186&ev=PageView&noscript=1"
/></noscript>
<!-- End Meta Pixel Code -->

<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --dark: #1E2A21;
    --dark-brown: #3B3230;
    --cream: #F5F0EB;
    --warm-white: #FAF8F5;
    --accent: #C4A882;
    --accent-dark: #A88B6A;
    --text: #2C2826;
    --text-light: #6B6560;
    --border: #E8E2DB;
  }

  body {
    font-family: 'Inter', -apple-system, sans-serif;
    color: var(--text);
    background: var(--warm-white);
    -webkit-font-smoothing: antialiased;
  }

  /* NAV */
  nav {
    background: var(--dark);
    padding: 18px 40px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .nav-logo {
    font-family: 'Playfair Display', serif;
    color: #fff;
    font-size: 22px;
    font-weight: 500;
    letter-spacing: 0.5px;
  }
  .nav-cta {
    background: transparent;
    border: 1.5px solid rgba(255,255,255,0.5);
    color: #fff;
    padding: 10px 24px;
    border-radius: 50px;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    cursor: pointer;
    text-decoration: none;
    transition: all 0.2s;
  }
  .nav-cta:hover { background: rgba(255,255,255,0.1); border-color: #fff; }

  /* HERO */
  .hero {
    background: var(--dark);
    padding: 80px 40px 100px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 80px;
    min-height: 600px;
  }
  .hero-content { max-width: 560px; }
  .hero h1 {
    font-family: 'Playfair Display', serif;
    font-size: 52px;
    font-weight: 500;
    color: #fff;
    line-height: 1.15;
    margin-bottom: 20px;
  }
  .hero p.subhead {
    color: rgba(255,255,255,0.7);
    font-size: 18px;
    line-height: 1.6;
    margin-bottom: 24px;
    font-weight: 300;
  }
  .hero-check-list { list-style: none; padding: 0; margin: 0 0 32px; }
  .hero-check-list li {
    color: rgba(255,255,255,0.85);
    font-size: 15px;
    padding: 6px 0 6px 28px;
    position: relative;
    line-height: 1.5;
  }
  .hero-check-list li::before {
    content: "\2713";
    position: absolute;
    left: 0;
    top: 6px;
    color: var(--accent);
    font-weight: 700;
    font-size: 16px;
  }
  .hero-btn {
    display: inline-block;
    background: var(--accent);
    color: var(--dark);
    padding: 16px 40px;
    border-radius: 50px;
    font-size: 15px;
    font-weight: 600;
    text-decoration: none;
    letter-spacing: 0.3px;
    transition: all 0.2s;
    cursor: pointer;
    border: none;
    font-family: 'Inter', sans-serif;
  }
  .hero-btn:hover { background: var(--accent-dark); }
  .hero-image {
    width: 560px;
    flex-shrink: 0;
  }
  .hero-video {
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: 16px;
    overflow: hidden;
    background: #000;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
  }
  .hero-video video {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
    object-fit: contain;
    background: #000;
  }

  /* TRUST BAR */
  .trust-bar {
    background: var(--cream);
    padding: 40px;
    display: flex;
    justify-content: center;
    gap: 60px;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--border);
  }
  .trust-item { text-align: center; }
  .trust-number {
    font-family: 'Playfair Display', serif;
    font-size: 32px;
    font-weight: 600;
    color: var(--dark);
  }
  .trust-label {
    font-size: 13px;
    color: var(--text-light);
    margin-top: 4px;
    font-weight: 400;
  }

  /* PRESS LOGOS */
  .press-section { background: var(--warm-white); padding: 50px 40px; }
  .press-logos {
    display: flex;
    justify-content: center;
    gap: 48px;
    flex-wrap: wrap;
    align-items: center;
    opacity: 0.4;
  }
  .press-logos span {
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
    letter-spacing: 0.5px;
  }

  /* B/A GATE + CAROUSEL */
  .ba-wrapper { max-width: 600px; margin: 0 auto; }
  .ba-gate {
    background: var(--dark-brown);
    border-radius: 16px;
    aspect-ratio: 3 / 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.2s;
    text-align: center;
    padding: 40px 24px;
  }
  .ba-gate:hover { background: #4a4240; }
  .ba-gate-icon { font-size: 48px; margin-bottom: 16px; }
  .ba-gate h3 {
    font-family: 'Playfair Display', serif;
    font-size: 24px;
    font-weight: 500;
    color: #fff;
    margin-bottom: 8px;
  }
  .ba-gate p {
    font-size: 14px;
    color: rgba(255,255,255,0.55);
    margin-bottom: 24px;
  }
  .ba-gate-btn {
    background: #c0392b;
    color: #fff;
    border: none;
    padding: 14px 36px;
    border-radius: 10px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    font-family: 'Inter', sans-serif;
    transition: background 0.2s;
  }
  .ba-gate-btn:hover { background: #a93226; }

  .ba-carousel {
    display: none;
    border-radius: 16px;
    overflow: hidden;
    position: relative;
    background: var(--dark-brown);
  }
  .ba-carousel.active { display: block; }
  .ba-track { display: flex; transition: transform 0.3s ease; }
  .ba-slide {
    min-width: 100%;
    aspect-ratio: 3 / 2;
    background: #2a2625;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ba-slide img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .ba-prev, .ba-next {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(255,255,255,0.9);
    border: 1px solid var(--border);
    color: var(--dark);
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
    z-index: 2;
  }
  .ba-prev { left: 12px; }
  .ba-next { right: 12px; }
  .ba-prev:hover, .ba-next:hover { background: #fff; }
  .ba-dots {
    position: absolute;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 8px;
    z-index: 2;
  }
  .ba-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(255,255,255,0.35);
    cursor: pointer;
    transition: background 0.2s;
    border: none;
  }
  .ba-dot.active { background: var(--accent); }

  /* B/A MODAL */
  .ba-modal-overlay {
    display: none;
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.6);
    z-index: 9999;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .ba-modal-overlay.active { display: flex; }
  .ba-modal {
    background: #fff;
    border-radius: 20px;
    padding: 40px 32px;
    max-width: 440px;
    width: 100%;
    position: relative;
    text-align: center;
    animation: fadeUp 0.3s ease;
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .ba-modal-close {
    position: absolute;
    top: 16px;
    right: 20px;
    background: none;
    border: none;
    font-size: 24px;
    color: var(--text-light);
    cursor: pointer;
  }
  .ba-modal h2 {
    font-family: 'Playfair Display', serif;
    font-size: 26px;
    font-weight: 500;
    color: var(--dark);
    margin-bottom: 12px;
  }
  .ba-modal > p {
    font-size: 14px;
    color: var(--text-light);
    line-height: 1.6;
    margin-bottom: 24px;
  }
  .ba-modal label {
    display: block;
    text-align: left;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-light);
    font-weight: 500;
    margin-bottom: 6px;
  }
  .ba-modal input {
    width: 100%;
    padding: 14px 16px;
    border: 1.5px solid var(--border);
    border-radius: 10px;
    font-size: 15px;
    font-family: 'Inter', sans-serif;
    margin-bottom: 16px;
    outline: none;
    background: var(--warm-white);
    transition: border-color 0.2s;
  }
  .ba-modal input:focus { border-color: var(--dark); background: #fff; }
  .ba-modal-submit {
    width: 100%;
    padding: 16px;
    background: var(--dark);
    color: #fff;
    border: none;
    border-radius: 12px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    font-family: 'Inter', sans-serif;
    transition: background 0.2s;
    margin-top: 4px;
  }
  .ba-modal-submit:hover { background: #2a3a2d; }
  .ba-modal-submit:disabled { opacity: 0.6; cursor: not-allowed; }
  .ba-consent {
    font-size: 11px;
    color: var(--text-light);
    margin-top: 16px;
    line-height: 1.5;
  }

  /* SECTIONS */
  section { padding: 80px 40px; }
  .section-center { max-width: 1100px; margin: 0 auto; }
  .section-header { text-align: center; margin-bottom: 60px; }
  .section-header h2 {
    font-family: 'Playfair Display', serif;
    font-size: 38px;
    font-weight: 500;
    color: var(--dark);
    margin-bottom: 16px;
  }
  .section-header p {
    font-size: 16px;
    color: var(--text-light);
    max-width: 600px;
    margin: 0 auto;
    line-height: 1.6;
  }

  /* WHO IS GIRTHFILL FOR */
  .who-section { background: var(--cream); }
  .who-content {
    max-width: 800px;
    margin: 0 auto;
    text-align: center;
  }
  .who-content p {
    font-size: 17px;
    color: var(--text);
    line-height: 1.75;
    margin-bottom: 20px;
  }

  /* PRICING */
  .pricing-card {
    max-width: 600px;
    margin: 0 auto;
    background: var(--dark);
    border-radius: 16px;
    padding: 48px;
    text-align: center;
    color: #fff;
  }
  .pricing-card h3 {
    font-family: 'Playfair Display', serif;
    font-size: 28px;
    font-weight: 500;
    margin-bottom: 8px;
  }
  .pricing-amount {
    font-size: 52px;
    font-weight: 700;
    margin: 16px 0 4px;
    color: var(--accent);
  }
  .pricing-detail {
    font-size: 15px;
    color: rgba(255,255,255,0.6);
    margin-bottom: 24px;
  }
  .pricing-features {
    text-align: left;
    margin: 24px auto;
    max-width: 360px;
  }
  .pricing-features li {
    list-style: none;
    padding: 8px 0;
    font-size: 15px;
    color: rgba(255,255,255,0.8);
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }
  .pricing-features li::before {
    content: "\2713";
    color: var(--accent);
    margin-right: 12px;
    font-weight: 700;
  }

  /* EXPERT */
  .expert-section {
    display: flex;
    gap: 60px;
    align-items: center;
    max-width: 1000px;
    margin: 0 auto;
  }
  .expert-photo {
    width: 320px;
    height: 400px;
    background: var(--cream);
    border-radius: 14px;
    flex-shrink: 0;
    overflow: hidden;
  }
  .expert-photo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .expert-content h2 {
    font-family: 'Playfair Display', serif;
    font-size: 32px;
    font-weight: 500;
    margin-bottom: 8px;
  }
  .expert-content .expert-title {
    font-size: 14px;
    color: var(--accent-dark);
    font-weight: 600;
    margin-bottom: 20px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .expert-content p {
    font-size: 15px;
    color: var(--text-light);
    line-height: 1.65;
    margin-bottom: 12px;
  }

  /* TESTIMONIALS */
  .testimonials-section { background: var(--cream); }
  .testimonials-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 24px;
  }
  .testimonial-card {
    background: #fff;
    border-radius: 14px;
    padding: 32px;
    border: 1px solid var(--border);
  }
  .stars { color: var(--accent); font-size: 16px; margin-bottom: 12px; letter-spacing: 2px; }
  .testimonial-card p {
    font-size: 14px;
    color: var(--text);
    line-height: 1.6;
    margin-bottom: 16px;
    font-style: italic;
  }
  .testimonial-card .name {
    font-size: 13px;
    font-weight: 600;
    color: var(--dark);
  }

  /* OFFICE */
  .office-section { background: var(--cream); }
  .office-grid {
    display: grid;
    grid-template-columns: 1fr 1.4fr;
    gap: 40px;
    align-items: stretch;
    max-width: 980px;
    margin: 0 auto;
  }
  .office-info { padding: 16px 0; }
  .office-info h3 {
    font-family: 'Playfair Display', serif;
    font-size: 28px;
    font-weight: 500;
    color: var(--dark);
    margin-bottom: 16px;
  }
  .office-address {
    font-size: 17px;
    line-height: 1.6;
    color: var(--text);
    margin-bottom: 14px;
  }
  .office-phone { font-size: 17px; margin-bottom: 22px; }
  .office-phone a {
    color: var(--accent-dark);
    text-decoration: none;
    font-weight: 600;
  }
  .office-phone a:hover { color: var(--dark); }
  .office-directions {
    display: inline-block;
    color: var(--dark);
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
    border-bottom: 2px solid var(--accent);
    padding-bottom: 2px;
    transition: color 0.2s;
  }
  .office-directions:hover { color: var(--accent-dark); }
  .office-map {
    border-radius: 14px;
    overflow: hidden;
    background: #fff;
    border: 1px solid var(--border);
    min-height: 360px;
  }
  .office-map iframe {
    width: 100%;
    height: 100%;
    display: block;
    border: 0;
    min-height: 360px;
  }

  /* FAQ */
  .faq-list { max-width: 750px; margin: 0 auto; }
  .faq-item {
    border-bottom: 1px solid var(--border);
    padding: 20px 0;
    cursor: pointer;
  }
  .faq-q {
    font-size: 16px;
    font-weight: 600;
    color: var(--dark);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .faq-q::after { content: "+"; font-size: 22px; color: var(--text-light); transition: transform 0.2s; }
  .faq-item.open .faq-q::after { content: "\2212"; }
  .faq-a {
    font-size: 14px;
    color: var(--text-light);
    line-height: 1.65;
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.3s ease, padding 0.3s ease;
    padding-top: 0;
  }
  .faq-item.open .faq-a { max-height: 300px; padding-top: 12px; }

  /* CTA BANNER */
  .cta-banner {
    background: var(--dark);
    padding: 60px 40px;
    text-align: center;
  }
  .cta-banner h2 {
    font-family: 'Playfair Display', serif;
    color: #fff;
    font-size: 36px;
    font-weight: 500;
    margin-bottom: 16px;
  }
  .cta-banner p {
    color: rgba(255,255,255,0.6);
    font-size: 16px;
    margin-bottom: 28px;
  }

  /* FOOTER */
  footer {
    background: var(--dark-brown);
    padding: 40px;
    text-align: center;
    color: rgba(255,255,255,0.5);
    font-size: 13px;
  }

  /* RESPONSIVE */
  @media (max-width: 900px) {
    nav { padding: 14px 20px; }
    .nav-logo { font-size: 16px; }
    .nav-cta { padding: 8px 14px; font-size: 11px; letter-spacing: 0.3px; }
    .hero { flex-direction: column; padding: 60px 24px 80px; gap: 40px; }
    .hero h1 { font-size: 36px; }
    .hero-image { width: 100%; }
    .testimonials-grid { grid-template-columns: 1fr; }
    .expert-section { flex-direction: column; }
    .press-logos { gap: 24px; }
    .press-logos span { font-size: 14px; }
    .office-grid { grid-template-columns: 1fr; gap: 24px; }
    .office-map, .office-map iframe { min-height: 300px; }
  }
</style>
<script src="/js/attribution.js"></script>
</head>
<body>
<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-PSX5GNZ"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->

<!-- NAV -->
<nav>
  <div class="nav-logo">Lushful Aesthetics</div>
  <a href="/girthfill-form-google?source=girthfill-nyc-google" target="_blank" rel="noopener" class="nav-cta">Request More Info</a>
</nav>

<!-- HERO -->
<div class="hero">
  <div class="hero-content">
    <h1>What is GirthFill&trade;?</h1>
    <p class="subhead">A non-surgical cosmetic procedure using FDA-approved hyaluronic acid dermal filler to enhance girth and thickness. Immediate, natural-looking results, performed in NYC by InjectorChris.</p>
    <ul class="hero-check-list">
      <li>Increased girth (flaccid &amp; erect)</li>
      <li>Longer flaccid length</li>
      <li>No effect on erectile function</li>
      <li>FDA-approved fillers, fully reversible</li>
      <li>Immediate confidence boost</li>
    </ul>
    <button class="hero-btn" onclick="window.open('/girthfill-form-google?source=girthfill-nyc-google','_blank')">Request More Info</button>
  </div>
  <div class="hero-image">
    <div class="hero-video">
      <video controls preload="metadata" playsinline
             poster="/videos/girthfill-consult-poster.jpg"
             onclick="if(this.paused)this.play()">
        <source src="/videos/girthfill-consult.mp4" type="video/mp4">
        Your browser does not support HTML5 video.
      </video>
    </div>
  </div>
</div>

<!-- B/A MODAL -->
<div class="ba-modal-overlay" id="baModal">
  <div class="ba-modal">
    <button class="ba-modal-close" onclick="closeBaModal()">&times;</button>
    <h2>Are you 18 or over?</h2>
    <p>Before and after images may contain sensitive content. Please verify your age and provide your contact information to view.</p>
    <form id="baForm" onsubmit="submitBaForm(event)">
      <label for="baName">Full Name</label>
      <input type="text" id="baName" placeholder="John Smith" required>
      <label for="baEmail">Email Address</label>
      <input type="email" id="baEmail" placeholder="your@email.com" required>
      <label for="baPhone">Phone Number</label>
      <input type="tel" id="baPhone" placeholder="(555) 123-4567" required>
      <button type="submit" class="ba-modal-submit" id="baSubmitBtn">View Photos</button>
      <div id="baError" style="color: #c44; font-size: 0.85rem; min-height: 1.2em;"></div>
    </form>
    <p class="ba-consent">We will never sell your information. By submitting you confirm you are over 18 and agree to be contacted about GirthFill.</p>
  </div>
</div>

<!-- TRUST BAR -->
<div class="trust-bar">
  <div class="trust-item">
    <div class="trust-number">5,000+</div>
    <div class="trust-label">Procedures Performed</div>
  </div>
  <div class="trust-item">
    <div class="trust-number">1-2"</div>
    <div class="trust-label">Average Girth Increase</div>
  </div>
  <div class="trust-item">
    <div class="trust-number">FDA</div>
    <div class="trust-label">Approved Filler Only</div>
  </div>
  <div class="trust-item">
    <div class="trust-number">3+ Years</div>
    <div class="trust-label">Results Duration</div>
  </div>
  <div class="trust-item">
    <div class="trust-number">100%</div>
    <div class="trust-label">Reversible</div>
  </div>
</div>

<!-- PRESS -->
<div class="press-section">
  <div class="press-logos">
    <span>GQ</span>
    <span>VICE</span>
    <span>Cosmopolitan</span>
    <span>New York Post</span>
    <span>The Late Show</span>
    <span>Men's Health</span>
  </div>
</div>

<!-- B/A RESULTS -->
<section id="results">
  <div class="section-center">
    <div class="section-header">
      <h2>Real Patient Results</h2>
      <p>Before and after photos from actual GirthFill&trade; patients. Age verification required to view.</p>
    </div>
    <div class="ba-wrapper">
      <div class="ba-gate" id="baGate" onclick="openBaModal()">
        <div class="ba-gate-icon">&#128065;</div>
        <h3>Before &amp; After Photos</h3>
        <p>Age verification required to view</p>
        <button class="ba-gate-btn">Click to View</button>
      </div>
      <div class="ba-carousel" id="baCarousel">
        <div class="ba-track" id="baTrack">
          <div class="ba-slide"><img src="images/Case-18-pair-1-1.png" alt="Before and After Case 18" loading="lazy"></div>
          <div class="ba-slide"><img src="images/Case-17-Pair-01-1.png" alt="Before and After Case 17" loading="lazy"></div>
          <div class="ba-slide"><img src="images/Case-16-Pair-01-1.png" alt="Before and After Case 16" loading="lazy"></div>
          <div class="ba-slide"><img src="images/Case-15-Pair-01-1.png" alt="Before and After Case 15" loading="lazy"></div>
          <div class="ba-slide"><img src="images/Case-14-Pair-01-1.png" alt="Before and After Case 14" loading="lazy"></div>
          <div class="ba-slide"><img src="images/Case-13-Pair-01-1.png" alt="Before and After Case 13" loading="lazy"></div>
          <div class="ba-slide"><img src="images/Case-12-Pair-01-1.png" alt="Before and After Case 12" loading="lazy"></div>
          <div class="ba-slide"><img src="images/Case-09-Pair-01-1.png" alt="Before and After Case 9" loading="lazy"></div>
          <div class="ba-slide"><img src="images/Case-07-Pair-01-1.png" alt="Before and After Case 7" loading="lazy"></div>
          <div class="ba-slide"><img src="images/Case-01-Pair-01-1.png" alt="Before and After Case 1" loading="lazy"></div>
        </div>
        <button class="ba-prev" onclick="slideBa(-1)">&#8249;</button>
        <button class="ba-next" onclick="slideBa(1)">&#8250;</button>
        <div class="ba-dots" id="baDots"></div>
      </div>
    </div>
  </div>
</section>

<!-- WHO IS GIRTHFILL FOR -->
<section class="who-section">
  <div class="section-center">
    <div class="section-header">
      <h2>Who is GirthFill&trade; For?</h2>
    </div>
    <div class="who-content">
      <p>GirthFill is designed for men who want a confidence-boosting aesthetic enhancement without surgery, downtime, or impact on sexual function. The procedure is fully customized to each patient's anatomy, baseline size, and aesthetic goals.</p>
      <p>Most patients are between 25 and 65, in good general health, and looking for natural-appearing results from a provider whose work they trust. Patients travel to NYC from across the US and internationally specifically to see InjectorChris.</p>
      <p>Whether you're new to aesthetic procedures or seeking revision work from a previous provider, our team will walk you through what's realistic for your goals during your consultation.</p>
    </div>
  </div>
</section>

<!-- PRICING -->
<section id="pricing">
  <div class="section-center">
    <div class="section-header">
      <h2>Transparent Pricing</h2>
      <p>No hidden fees. Financing available through Cherry with soft credit checks.</p>
    </div>
    <div class="pricing-card">
      <h3>GirthFill&trade; Treatment</h3>
      <div class="pricing-amount">$8,500</div>
      <div class="pricing-detail">Starting price for 10 syringes</div>
      <ul class="pricing-features">
        <li>10 syringes of FDA-approved hyaluronic acid filler</li>
        <li>Typically adds 1-2 inches of girth</li>
        <li>Additional syringes: $700 each</li>
        <li>Results last 2-3 years</li>
        <li>Performed by InjectorChris</li>
        <li>Financing available through Cherry</li>
      </ul>
      <button class="hero-btn" onclick="window.open('/girthfill-form-google?source=girthfill-nyc-google','_blank')">Request More Info</button>
    </div>
  </div>
</section>

<!-- EXPERT -->
<section id="expert">
  <div class="section-center">
    <div class="expert-section">
      <div class="expert-photo"><img src="https://i0.wp.com/lushfulaesthetics.com/wp-content/uploads/2026/04/injector-chris-lushful-aesthetics-1.jpg?resize=350%2C526&ssl=1" alt="Chris Bustamante, DNP, NP-C — InjectorChris"></div>
      <div class="expert-content">
        <h2>Chris Bustamante, DNP, NP-C</h2>
        <div class="expert-title">Founder, Lushful Aesthetics &bull; InjectorChris</div>
        <p>Chris Bustamante is a Doctorate-level Aesthetic Nurse Practitioner trained at Columbia University. He is one of the most sought-after penile enhancement specialists in the world, performing GirthFill procedures multiple times daily.</p>
        <p>Patients travel from across the US, Europe, the Middle East, and Australia specifically to see InjectorChris for his GirthFillosophy&reg; technique, which prioritizes anatomical harmony, natural contour, and personalized aesthetic goals.</p>
        <p>He is also one of the few providers with extensive experience in both circumcised and uncircumcised patients, as well as complex revision cases from other providers.</p>
      </div>
    </div>
  </div>
</section>

<!-- TESTIMONIALS -->
<section class="testimonials-section">
  <div class="section-center">
    <div class="section-header">
      <h2>What Our Patients Say</h2>
    </div>
    <div class="testimonials-grid">
      <div class="testimonial-card">
        <div class="stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
        <p>"The process was so much easier than I expected. Chris made me feel comfortable from the first consultation. The results exceeded my expectations &mdash; I wish I had done this years ago."</p>
        <div class="name">M.R. &bull; Verified Patient</div>
      </div>
      <div class="testimonial-card">
        <div class="stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
        <p>"I flew in from LA specifically for InjectorChris. Worth every mile. The technique is clearly refined &mdash; the results look and feel completely natural. My confidence is through the roof."</p>
        <div class="name">T.K. &bull; Verified Patient</div>
      </div>
      <div class="testimonial-card">
        <div class="stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
        <p>"I had a bad experience with another provider and Chris completely fixed it. The revision work was incredible &mdash; no more lumps, completely smooth. He genuinely cares about the outcome."</p>
        <div class="name">D.L. &bull; Verified Patient</div>
      </div>
    </div>
  </div>
</section>

<!-- OFFICE -->
<section id="office" class="office-section">
  <div class="section-center">
    <div class="section-header">
      <h2>Visit Our New York City Office</h2>
      <p>In Midtown Manhattan, steps from Grand Central Terminal.</p>
    </div>
    <div class="office-grid">
      <div class="office-info">
        <h3>Lushful Aesthetics &mdash; NYC</h3>
        <p class="office-address">
          18 E 41st St, 14th Floor<br>
          New York, NY 10017
        </p>
        <p class="office-phone">
          <a href="tel:+19172773398">(917) 277-3398</a>
        </p>
        <a href="https://www.google.com/maps/dir/?api=1&destination=18+E+41st+St+14th+Floor+New+York+NY+10017"
           target="_blank" rel="noopener" class="office-directions">Get Directions &rarr;</a>
      </div>
      <div class="office-map">
        <iframe
          src="https://maps.google.com/maps?q=18+E+41st+St+14th+Floor+New+York+NY+10017&output=embed"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"
          allowfullscreen></iframe>
      </div>
    </div>
  </div>
</section>

<!-- FAQ -->
<section id="faq">
  <div class="section-center">
    <div class="section-header">
      <h2>Frequently Asked Questions</h2>
    </div>
    <div class="faq-list">
      <div class="faq-item" onclick="toggleFaq(this)">
        <div class="faq-q">Is the procedure painful?</div>
        <div class="faq-a">Most patients report little to no pain thanks to local anesthetic. Laughing gas is also provided for anxiety relief. Patients are often surprised at how comfortable the procedure is.</div>
      </div>
      <div class="faq-item" onclick="toggleFaq(this)">
        <div class="faq-q">How long do results last?</div>
        <div class="faq-a">Results last 2-3 years in the shaft and approximately 1 year in the glans. Most patients never fully return to their original baseline due to collagen formation. Touch-ups are typically scheduled every 12-18 months.</div>
      </div>
      <div class="faq-item" onclick="toggleFaq(this)">
        <div class="faq-q">Does it affect erectile function or sensitivity?</div>
        <div class="faq-a">No. GirthFill does not affect sensitivity or erection quality in any way. This is purely an aesthetic procedure.</div>
      </div>
      <div class="faq-item" onclick="toggleFaq(this)">
        <div class="faq-q">Is it reversible?</div>
        <div class="faq-a">Yes. Since we use hyaluronic acid filler, it can be dissolved completely if desired. The filler also naturally metabolizes over time.</div>
      </div>
      <div class="faq-item" onclick="toggleFaq(this)">
        <div class="faq-q">What is the recovery time?</div>
        <div class="faq-a">Mild tenderness and swelling for a few days to two weeks. Work and light activity can resume in 1-2 days. No sexual activity for a minimum of 2 weeks.</div>
      </div>
    </div>
  </div>
</section>

<!-- CTA BANNER -->
<div class="cta-banner">
  <h2>Ready to Take the Next Step?</h2>
  <p>Request more information about your consultation.</p>
  <button class="hero-btn" onclick="window.open('/girthfill-form-google?source=girthfill-nyc-google','_blank')">Request More Info</button>
</div>

<!-- FOOTER -->
<footer>
  <p>&copy; 2026 Lushful Aesthetics. All rights reserved. | NYC &bull; San Diego</p>
</footer>

<script>
  function toggleFaq(el) {
    el.classList.toggle('open');
  }

  /* B/A Modal */
  function openBaModal() {
    document.getElementById('baModal').classList.add('active');
  }
  function closeBaModal() {
    document.getElementById('baModal').classList.remove('active');
  }
  document.getElementById('baModal').addEventListener('click', function(e) {
    if (e.target === this) closeBaModal();
  });

  /* B/A Form Submit → Reveal Carousel */
  async function submitBaForm(e) {
    e.preventDefault();
    var name  = document.getElementById('baName').value.trim();
    var email = document.getElementById('baEmail').value.trim();
    var phone = document.getElementById('baPhone').value.trim();
    if (!name || !email || !phone) return;

    var btn = document.getElementById('baSubmitBtn');
    var originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Loading...';

    try {
      var attribution = window.lushfulAttribution ? window.lushfulAttribution() : {};
      var body = Object.assign(
        { name: name, email: email, phone: phone, source: 'girthfill-carousel' },
        attribution
      );
      var res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error('ba-post-failed:' + res.status);
      revealCarousel();
    } catch (err) {
      console.error('B&A lead capture failed', err);
      var errEl = document.getElementById('baError');
      if (errEl) errEl.textContent = 'Something went wrong. Please try again.';
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  function revealCarousel() {
    document.getElementById('baModal').classList.remove('active');
    document.getElementById('baGate').style.display = 'none';
    document.getElementById('baCarousel').classList.add('active');
    buildDots();
  }

  /* Carousel */
  var baIndex = 0;
  var baTotal = document.querySelectorAll('.ba-slide').length;

  function slideBa(dir) {
    baIndex = (baIndex + dir + baTotal) % baTotal;
    updateCarousel();
  }
  function goToBaSlide(i) {
    baIndex = i;
    updateCarousel();
  }
  function updateCarousel() {
    document.getElementById('baTrack').style.transform = 'translateX(-' + (baIndex * 100) + '%)';
    var dots = document.querySelectorAll('.ba-dot');
    dots.forEach(function(d, i) {
      d.classList.toggle('active', i === baIndex);
    });
  }
  function buildDots() {
    var container = document.getElementById('baDots');
    container.innerHTML = '';
    for (var i = 0; i < baTotal; i++) {
      var dot = document.createElement('button');
      dot.className = 'ba-dot' + (i === 0 ? ' active' : '');
      dot.setAttribute('data-i', i);
      dot.onclick = function() { goToBaSlide(parseInt(this.getAttribute('data-i'))); };
      container.appendChild(dot);
    }
  }
</script>

</body>
</html>
```

- [ ] **Step 2: Verify file loads in dev server**

```bash
cd ~/Claude/lushfulcontent && npm run dev
```

Then in a browser, visit `http://localhost:3000/girthfill-nyc-google`. Expected:
- Hero loads with "What is GirthFill?" headline + checkmark list + click-to-play video
- Trust bar shows 5 stats
- Press logos visible (lightly opaque)
- B/A gate clickable → modal opens
- All "Request More Info" buttons open `/girthfill-form-google?source=girthfill-nyc-google` in new tab
- NYC office section shows address + Google Maps embed
- FAQ items expand on click
- No console errors

Kill the dev server (Ctrl-C).

- [ ] **Step 3: Commit**

```bash
cd ~/Claude/lushfulcontent && git add girthfill-nyc-google.html && git commit -m "$(cat <<'EOF'
feat: add girthfill-nyc-google.html (Google Ads NYC landing page)

NYC-targeted landing page modeled on the structure of the main site's
/lushful-aesthetics-signup page, adapted for Google Ads with:
- Our self-hosted hero video alongside reference page's checkmark
  benefits list
- Trust bar + press logos (high converters retained from existing
  landing)
- Age-gated before/after carousel (consistent with existing landing)
- New "Who is GirthFill For?" section adapted from reference page
- NYC office only (no SD card; SD will get its own google landing)
- Trimmed FAQ (top 5 questions only) to keep page conversion-focused

All CTAs link to /girthfill-form-google?source=girthfill-nyc-google.

Existing girthfill-nyc.html (Meta funnel) unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Manual E2E Verification

**Files:**
- No code changes (verification only)

**Context for the engineer:** This task is a checklist of manual checks against the deployed code. The "Lead Submission" Google Ads conversion action will not be wired yet (Task 5 covers that, blocked on user creating the action in Google Ads UI). Skip the Google Ads conversion firing checks until Task 5 is complete; all other checks should pass with code from Tasks 1-3.

- [ ] **Step 1: Push to a preview deploy**

```bash
cd ~/Claude/lushfulcontent && git push origin HEAD
```

Vercel will autodeploy. Note the preview URL from Vercel's GitHub check, or use the production URL `https://start.lushfulaesthetics.com` after merging.

- [ ] **Step 2: Run the E2E checklist**

Use a test email (e.g. `e2e-test-<timestamp>@example.com`) so the lead is easy to find in Close/Mailchimp/Supabase.

**Yes path:**
1. Visit `/girthfill-nyc-google`. Confirm hero video loads, B/A gate works, all "Request More Info" CTAs open `/girthfill-form-google?source=girthfill-nyc-google` in a new tab.
2. Fill Step 1 with test contact. Click Continue.
3. Expected in Network tab: `POST /api/lead` returns 200 with `lead_id`.
4. Expected in Meta Events Manager Test Events: `Lead` event fired.
5. Expected in Supabase `leads` table: new row with `source = 'girthfill-nyc-google'`, `qualified = NULL`.
6. Expected in Close: lead created with status "Potential", `CLOSE_CF_SOURCE = 'girthfill-nyc-google'`.
7. Expected in Mailchimp: subscriber created with tags `girthfill-nyc-google` + `SQ Lander`.
8. On Step 2, click "Yes, I'm Interested".
9. Expected in Network tab: `POST /api/lead-update` returns 200.
10. Expected in Meta Events Manager Test Events: `CompleteRegistration` event fired.
11. Expected in Supabase: same lead row updated with `qualified = true`, `qualified_at` set.
12. Expected in Close: lead status flipped to "Qualified", `CLOSE_CF_QUALIFIED = 'Yes'`.
13. Expected in Mailchimp: tag `girthfill-qualified` added to subscriber.
14. On Step 3a, click "Book An Appointment". Boulevard widget opens in new tab. Network shows `POST /api/lead-update` with `cta_clicked: 'book'`.
15. Expected in Close: `CLOSE_CF_CTA_CLICKED = 'Book Appointment'`.

**No path:**
16. Visit `/girthfill-nyc-google` again, fresh tab. Submit Step 1 with a different test email.
17. Confirm Step 1 fires Lead event + Lead Submission ads conversion (once Task 5 is complete).
18. On Step 2, click "Not Right Now".
19. Expected in Close: lead status flipped to "Bad Fit", `CLOSE_CF_QUALIFIED = 'No'`.
20. Expected in Mailchimp: tag `girthfill-not-qualified` added.
21. On Step 3b, verify both social buttons open in new tabs:
    - Instagram → `https://www.instagram.com/lushfulaesthetics/`
    - YouTube → `https://www.youtube.com/channel/UCh6HankCyOK9CgsS-uvTjGg/`
22. Click "Visit Our Homepage" → opens `https://lushfulaesthetics.com`.

- [ ] **Step 3: Clean up test leads**

In Close, mark or delete the two test leads created during E2E. Same in Mailchimp (unsubscribe or archive). Supabase rows can stay (analytics value).

- [ ] **Step 4: Commit a verification note**

Create `~/Claude/lushfulcontent/docs/verifications/2026-05-12-girthfill-google-ads-nyc-e2e.md` (mkdir if needed):

```bash
mkdir -p ~/Claude/lushfulcontent/docs/verifications
```

```markdown
# 2026-05-12 — Girthfill Google Ads NYC E2E Verification

Verified by: <your name>
Deploy URL tested: <production or preview URL>

## Yes path
- [ ] Step 1 contact submit creates Supabase lead with source=girthfill-nyc-google
- [ ] Close lead created with status Potential
- [ ] Mailchimp subscriber tagged girthfill-nyc-google + SQ Lander
- [ ] Meta Lead event fired (Events Manager Test Events)
- [ ] (After Task 5) Google Ads "Lead Submission" conversion fired
- [ ] Step 2 yes: Close status → Qualified, Mailchimp adds girthfill-qualified
- [ ] Meta CompleteRegistration event fired
- [ ] Google Ads "Qualified Lead" conversion fired
- [ ] Step 3a Book: Boulevard widget opens, Close CF CTA_CLICKED = Book Appointment

## No path
- [ ] Step 2 no: Close status → Bad Fit, Mailchimp adds girthfill-not-qualified
- [ ] No Meta CompleteRegistration fired
- [ ] No Google Ads conversion fired at Step 2 no
- [ ] Step 3b social buttons open IG and YouTube in new tabs
- [ ] Visit Our Homepage → lushfulaesthetics.com

## Notes
<any observed issues>
```

Commit:

```bash
cd ~/Claude/lushfulcontent && git add docs/verifications/2026-05-12-girthfill-google-ads-nyc-e2e.md && git commit -m "$(cat <<'EOF'
docs: add E2E verification record for girthfill-nyc-google

Manual verification checklist with observed results. Confirms the
contact-first funnel writes correctly to Supabase, Close, and Mailchimp,
and that Meta Pixel + (where wired) Google Ads conversions fire at the
right points.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire the Real Google Ads Conversion Label (Post-Launch Prereq)

**Files:**
- Modify: `girthfill-form-google.html` (replace `LEAD_SUBMISSION_LABEL` placeholder)

**Context for the engineer:** This task is **blocked on the user creating the new "Lead Submission" conversion action in Google Ads UI** (Tools → Conversions → New → Website, Lead category, one-per-click). Once created, the user pastes the conversion label (the string after `AW-11150884432/`) into the chat. The engineer then swaps the placeholder.

- [ ] **Step 1: Receive the conversion label from user**

User pastes the label string. Example format: `Abc123XYZ-defGHI4-jkl`.

- [ ] **Step 2: Replace placeholder in form file**

Open `~/Claude/lushfulcontent/girthfill-form-google.html`. Find the line:

```javascript
'send_to': 'AW-11150884432/LEAD_SUBMISSION_LABEL'
```

Replace `LEAD_SUBMISSION_LABEL` with the real label string. The line should now read (example):

```javascript
'send_to': 'AW-11150884432/Abc123XYZ-defGHI4-jkl'
```

- [ ] **Step 3: Verify locally**

```bash
cd ~/Claude/lushfulcontent && npm run dev
```

Submit a test Step 1 contact at `http://localhost:3000/girthfill-form-google?source=girthfill-nyc-google`. Open Network tab, filter for `google-analytics.com` or `googleadservices.com`. Expected: a conversion ping fires with the new label.

- [ ] **Step 4: Commit and deploy**

```bash
cd ~/Claude/lushfulcontent && git add girthfill-form-google.html && git commit -m "$(cat <<'EOF'
chore: wire real Google Ads Lead Submission conversion label

Replaces LEAD_SUBMISSION_LABEL placeholder with the conversion label
created in Google Ads UI. Step 1 contact submit now fires the real
conversion to AW-11150884432.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git push origin HEAD
```

- [ ] **Step 5: Verify in Google Ads Test Events**

After Vercel deploys, submit one more test Step 1 contact through the production URL. In Google Ads → Tools → Conversions → "Lead Submission", confirm a conversion is recorded within 24 hours. Update the verification record from Task 4 with confirmation.

---

## Self-Review

**Spec coverage check:**
- ✓ New landing page `girthfill-nyc-google.html` → Task 3
- ✓ New form `girthfill-form-google.html` → Task 2
- ✓ API source enum widening → Task 1
- ✓ Contact-first flow (Step 1 contact → Step 2 qualifier → Step 3a/3b branch) → Task 2
- ✓ Two-tier Google Ads conversions (Lead Submission + Qualified Lead) → Task 2 + Task 5
- ✓ Two-tier Meta Pixel (Lead + CompleteRegistration) → Task 2
- ✓ Disqualified-but-captured flow → covered by Task 2's `answerQualification(false)` + Task 1's existing API support
- ✓ CRM mapping (Close NEW → Q/Bad Fit, Mailchimp tags, Supabase qualified field) → exercised end-to-end in Task 4 E2E
- ✓ Social-follow exit (IG + YouTube) → Task 2 Step 3b markup
- ✓ NYC office only → Task 3 office section
- ✓ Hero video + checkmark benefits list → Task 3 hero section
- ✓ Tests for new source enum values → Task 1
- ✓ Manual E2E verification → Task 4
- ✓ Launch prerequisite (conversion action creation) → Task 5

**Placeholder scan:** the only `LEAD_SUBMISSION_LABEL` placeholder in the code is explicitly called out, deliberate, and Task 5 swaps it. No "TBD", "TODO", "implement later", "fill in details" anywhere.

**Type consistency:** function/handler names checked across tasks. `submitContact`, `answerQualification`, `recordCta`, `showStep`, `showError`, `gtag_report_lead_submission`, `gtag_report_qualified_lead` are all consistent between Task 2 (where they're defined) and Tasks 4 + 5 (where they're referenced). Source enum values consistent: `'girthfill-nyc-google'` used in Task 1 tests, Task 2 form, Task 3 landing CTAs.
