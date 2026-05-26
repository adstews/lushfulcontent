---
title: Bluegrass Supplements — Ultimate Wellness Pack Landing Page
date: 2026-05-26
owner: Nick
status: design
---

# Bluegrass Ultimate Wellness Pack Landing Page

## Context

Bluegrass Supplements is a new client (no prior landers in any repo). They sell physician-formulated sublingual sprays. The product we're targeting is the **Ultimate Wellness Pack** — a 4-spray bundle: B Boost B-12, Immune Response, Drift Away Sleep Spray, Hair & Nail Support Spray. Each is $39 individually ($156 separately); bundle is $99 one-time or $84.15/month on subscription (15% off).

**Goal:** A long-form direct-response landing page modeled structurally on Primal Queen's `/pages/tiktok` page, adapted for Bluegrass's brand, product line, and policy constraints.

**Inspiration source:** https://primalqueen.com/pages/tiktok — referenced for section rhythm, copy devices, and DR patterns. Not for visual design (different brand) or for any policy claims (Primal Queen has a 365-day MBG; Bluegrass does not).

## Goals

- Long-form DR page with subscription-first CTA (mirrors Primal Queen rhythm)
- Each of the 4 sprays gets its own deep-dive section (this is unique to us; Primal Queen has one product)
- Vercel preview for client review before Shopify handoff
- Self-contained HTML that pastes cleanly into a Shopify Page (full-bleed, theme nav/footer hidden)
- Bluegrass blue/white brand palette with Primal Queen's structural rhythm

## Non-goals

- No founder story (Bluegrass doesn't have a strong one; we lean on science instead)
- No money-back guarantee copy of any kind (Bluegrass policy doesn't support it — see [[project-bluegrass-no-mbg]])
- No HSA/FSA emphasis (per client direction — see [[project-bluegrass-no-hsa-fsa-emphasis]])
- No quiz funnel (defer to a separate lander if Bluegrass wants one)
- No lead-capture form (CTA goes straight to Shopify cart)
- No build step / framework (vanilla HTML, matches `worth-hp-pendant-landing` pattern)

## Architecture

- **Local path:** `/Users/nicholasstewart/Claude/bluegrass-landers/`
- **GitHub repo:** `adstews/bluegrass-landers` (private)
- **Vercel project:** `bluegrass-landers` → preview at `bluegrass-landers.vercel.app`
- **Repo layout:**
  ```
  bluegrass-landers/
    index.html        # The Ultimate Wellness Pack lander
    vercel.json       # skip install/build, output dir "."
    README.md         # Shopify paste-in instructions + TODO list
  ```
- **Stack:** Vanilla HTML + inline `<style>` + inline `<script>`. No build step. CSS variables for the palette. Same pattern as `/Users/nicholasstewart/Claude/worth-hp-pendant-landing/`.
- **Image strategy:** Placeholder URLs via `placehold.co` with `data-replace` attributes so Nick can search-replace with Shopify CDN URLs after upload.
- **Shopify full-bleed strategy:** Include a scoped CSS block that hides theme header/footer on the specific page slug. Selectors marked TODO since they depend on Bluegrass's active theme (Dawn vs Impulse vs custom). On Vercel preview this CSS is inert (no theme nav exists).

## Page sections (announcement bar + 18 content sections)

### 0. Announcement bar (sticky chrome, not counted as a section)
- Copy: `FREE SHIPPING · CANCEL ANYTIME · 4 WELLNESS SPRAYS, 1 MONTHLY DELIVERY`
- Background: navy blue, white text
- Sticky on scroll

### 1. Hero
- Eyebrow trust badge ("Trusted by thousands" — generic if real numbers unconfirmed)
- Headline (working draft, agitate-pain): "STOP Choking Down 12 Pills a Day That Your Body Barely Absorbs"
- Subhead: "Get all 4 sublingual sprays for $84.15/month — less than $21 per spray. Save $71.85 vs. buying them separately."
- Primary CTA: "CLAIM MY STARTER PACK" → subscription cart deeplink
- Secondary trust row: star rating + bottles-shipped count (placeholders, replace with real numbers)
- Soft countdown: 24h rolling "Today's allocation ends in 0d 13h 6m"
- Visual: hero shot of all 4 spray bottles on neutral background (placeholder)

### 2. Trust strip (icon row)
Physician-Formulated · Lab-Tested · Third-Party Tested · Made in USA

(No HSA/FSA badge per client direction.)

### 3. Customer testimonial scroller
- 4–5 customer quotes with photo placeholders
- Voice modeled on Bluegrass's existing Jason / Drift Away testimonial
- One quote per spray + one bundle quote
- Disclaimer: "Individual results vary"

### 4. The Problem — agitate-pain grid (4 cards)
1. "You forget half your pills by 10am"
2. "Capsules dissolve in your stomach — maybe 10% of what's on the label actually reaches your bloodstream"
3. "Gummies are basically candy with a $40/month price tag"
4. "Stacks of bottles, $200+/month, and you still feel tired"

### 5. The Bundle Reveal
- "Meet the Ultimate Wellness Pack"
- Hero of all 4 bottles together
- Tagline: "Morning to night. One spray each. Four results."
- One-sentence intro for each spray: B-12 = morning energy, Immune = daily defense, Drift Away = bedtime calm, Hair & Nail = visible glow-up
- Anchor: "$156 if bought separately. $84.15/month as a pack."

### 6–9. Deep dives (one per spray)
Same template for each:
- Bottle hero image (placeholder)
- Spray name + available flavors
- Headline benefit (custom per spray)
- 4 benefit bullets pulled from the product page
- Mechanism callout (sublingual absorption story)
- Mini-CTA: "Add the Pack"
- Alternating layout (image-left / image-right)

**6. B Boost B-12**
- Headline: "Crash-Free Energy That Actually Lasts"
- Benefits: natural energy production, healthy metabolism, mental clarity & focus, reduces occasional fatigue
- Flavors: orange / raspberry / vanilla / mint

**7. Immune Response**
- Headline: "Your Year-Round Defense"
- Benefits: immune system support, year-round resilience, antioxidant support, overall wellness
- Flavors: same range

**8. Drift Away Sleep Spray**
- Headline: "Fall Asleep Without the Hangover"
- Benefits: relaxation & calmness, restful & restorative sleep, ease occasional sleeplessness, healthy sleep cycle
- Ingredients to highlight: GABA, melatonin, valerian root
- Hero testimonial: Jason's review

**9. Hair & Nail Support Spray**
- Headline: "The Glow-Up You'll See in the Mirror"
- Benefits: biotin → keratin production, hair growth & strength, nail integrity & resilience, cellular energy metabolism
- Flavors: peppermint, french vanilla

### 10. Why Sprays Beat Pills (science section — replaces founder story)
- Headline: "Why Sublingual Sprays Outperform Every Pill in Your Cabinet"
- Side-by-side: Spray vs. Capsule vs. Gummy
- Key claims (MUST source-check before launch):
  - Sublingual absorption is ~9x faster than oral capsules
  - 90% of capsule contents lost to first-pass metabolism
  - Spray bypasses digestive system entirely
- Diagram placeholder: absorption-pathway illustration
- Citation footnotes — if no real source exists, hedge the claims ("studies suggest", "research indicates")

### 11. What to expect timeline
- Day 1: B-12 hits within minutes — first energy lift, no crash
- Week 1: Sleep quality stabilizes, immune system primed
- Month 1: Energy consistent through the afternoon
- Month 3: Hair feels stronger, nails grow faster
- Month 6: Compounding benefits — clearer skin, deeper rest, fewer sick days
- Visual: vertical timeline with milestone markers
- Asterisk disclaimer on all claims

### 12. Comparison table
| | Ultimate Wellness Pack | The "stack 4 brands" approach |
|---|---|---|
| Cost | $84.15/mo (subscribed) | $156+/mo across 4 bottles |
| Absorption | Sublingual, fast | 10-30% of pills reach bloodstream |
| Hassle | One delivery, 4 sprays, 30 seconds | 4 reorders, 4 schedules |
| Sourcing | Physician-formulated, third-party tested | Varies by brand |

### 13. The Bluegrass Promise (6 badges)
Physician-Formulated · Third-Party Tested · Lab-Tested · Made in USA · No Artificial Fillers · Free Shipping Always

### 14. Who it's for / NOT for
**For you if:** tired of forgetting pills, want morning energy without coffee crashes, need help winding down, want visible hair/nail improvement, care about absorption.

**NOT for you if:** love swallowing capsules, think gummies are good enough, not committed to consistent daily use.

### 15. Scarcity / urgency
- "May allocation almost gone"
- Soft scarcity, no hard countdown
- Framing: subscription slots open monthly, current month low

### 16. Pricing block (main offer)
Two toggles, **Subscribe selected by default**:

- **Subscribe** — $84.15/month — "SAVE 15%" badge — "Cancel anytime · Skip or pause · Free shipping"
  - CTA: "START MY MONTHLY DELIVERY" → `https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521`
- **One-Time** — $99 — "Save $57 vs. retail" badge — "Free shipping"
  - CTA: "BUY THE BUNDLE" → `https://www.bluegrassvitamins.com/cart/47823287189745:1`

Microcopy below: "Ships within 24h · Free shipping always · Cancel subscription anytime in 2 clicks"

### 17. FAQ (10 items)
1. How do I cancel my subscription? (Truthful: account portal, 2 clicks, no questions)
2. How does the subscription work? (Monthly delivery, same 4 sprays)
3. Can I skip a month or pause? (Yes, from account)
4. Why sprays not pills? (Absorption + no-fuss daily dose)
5. When will I feel a difference? (B-12 day 1, sleep within a week, hair/nail 1-3 mo)
6. Can I take all 4 sprays at once? (Yes — designed to be layered)
7. Are they safe with my medications? (Not medical advice; check with doctor)
8. Where are they made? (USA, third-party tested)
9. What flavors? (Lists per spray)
10. What if I'm allergic to an ingredient? (Direct to ingredient lists on individual product pages)

### 18. Final CTA + Low-Commitment Promise (NOT a MBG)
- Repeat hero CTA: "CLAIM MY STARTER PACK"
- "Low-Commitment Promise" box:
  - Cancel subscription anytime, no questions
  - Skip or pause from your account in 2 clicks
  - Free shipping always
  - Third-party tested · Physician-formulated · Made in USA
- Minimal footer: copyright, contact, links to refund-policy / terms / privacy

## Brand & visual treatment

### Color palette (best-guess; flag for client confirmation)
- Primary navy: `#1B4D8C`
- Accent blue: `#5BA3D9`
- Cream bg: `#FAF8F4`
- Ink (body text): `#1A2238`
- Sand (alt section bg): `#F0EDE6`
- Gold (urgency accent): `#D4A853`

### Typography
- Headlines: Fraunces (serif, premium-editorial)
- Body: Inter (clean modern sans)
- Both via Google Fonts CDN

### Imagery
- All product/lifestyle as labeled placeholders via `placehold.co`
- Placeholder format: `<img src="https://placehold.co/1200x800/1B4D8C/FFFFFF?text=Hero+4+Bottles" data-replace="hero-4-bottles" alt="...">`
- Search-replace `data-replace` keys with Shopify CDN URLs after asset upload
- GIFs (timeline, absorption diagram) stay as static placeholders with a note in `data-replace`

### Section rhythm
- Alternating cream / sand / navy backgrounds for visual pacing
- Navy reserved for "turn" moments (problem agitation, urgency)
- No two adjacent sections share the same bg

## Copy strategy — DR devices

| Device | Where used |
|---|---|
| Problem-agitation hero | Sections 1, 4 |
| Comparative claims (Xx more absorption) | Section 10 |
| Timeline benefits | Section 11 |
| Soft scarcity | Section 15, announcement bar |
| Comparison table | Section 12 |
| Exclusion ("not for you if") | Section 14 |
| Anchor pricing ($156 vs $84.15) | Hero, Section 5, Section 16 |
| Per-unit math ($21/spray) | Sections 5, 16 |
| Repeated CTA copy | "CLAIM MY STARTER PACK" in 1, 5, 9, 12, 16, 18 |
| Subscription flexibility as risk-reversal | Sections 16, 18, FAQ |
| Quality/authority stack | Sections 2, 10, 13 |

**Explicitly NOT used:**
- Money-back guarantee of any duration
- HSA/FSA "might be free" hook
- Fabricated founder story or person
- Made-up customer testimonial counts

## CTA mechanics

All buy buttons deeplink to Shopify cart URLs. Works identically on Vercel preview (cross-domain) and Shopify Page (same-domain):

- **Subscription:** `https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521`
- **One-time:** `https://www.bluegrassvitamins.com/cart/47823287189745:1`

`target="_self"` on both — same-tab checkout flow.

**Reference IDs (lock these in code as constants):**
- variant_id: `47823287189745`
- selling_plan_id: `5323489521`
- product handle: `ultimate-wellness-bundle-1`

## Open items / TODOs (also in README handoff)

1. **Brand hex codes** — Verify with client; current values are best-guess from site inspection.
2. **Real customer counts** — Use real numbers or remove placeholder counts.
3. **Real testimonials** — 4–5 placeholder quotes; swap with real reviews.
4. **Hero photography** — All as labeled placeholders.
5. **Spray bottle individual photos** — Pull from Bluegrass product pages or wait for client assets.
6. **Absorption diagram** — Static placeholder; designer can produce later.
7. **Theme selectors for full-bleed CSS** — Need Bluegrass's active theme to hide nav/footer; written generically with TODO.
8. **Source citation for "9x faster absorption"** — Need real source before launch; remove or hedge if no source.
9. **Subscription frequency options** — Locked to monthly (only option exposed in product .js). Expand if more intervals exist.
10. **Shopify Page slug** — Update full-bleed CSS selector once page slug is set.

## Definition of done

- [ ] Repo `adstews/bluegrass-landers` created and pushed
- [ ] Vercel project linked, preview URL live
- [ ] `index.html` renders all 18 sections on desktop and mobile
- [ ] All CTAs deeplink correctly (clicking through lands on Bluegrass cart with right variant/selling_plan)
- [ ] No broken images (all placeholders use working `placehold.co` URLs)
- [ ] README documents the Shopify Page paste-in process and the TODO list
- [ ] Preview URL shared with Bluegrass for review
