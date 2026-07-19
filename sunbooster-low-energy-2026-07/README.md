# SunBooster | Search | NB | Low Energy | US | 2026-07 — build record

Built and **launched live** 2026-07-19 via AdKit MCP, per Nick's instruction (traffic ASAP before the
Tuesday client call). Client-note thesis: *"test search terms / keywords around being low energy
(related to lack of sunlight)"* — Google side of the Google/Amazon PPC ask.

## Settings (all verified by read-back + change history)

| Setting | Value |
|---|---|
| Account | SunLED Google Ads `2343884684` (bills in **EUR**) |
| Campaign | `24051848293` — ENABLED |
| Budget | **€87/day ≈ $100/day** (EUR/USD 1.1446 at launch), own budget `15729147519`, standard delivery |
| Bidding | Maximize Clicks (`target_spend`), **no CPC ceiling** (per Nick) |
| Networks | Google Search only — partners OFF, display OFF |
| Geo | United States (`2840`), **PRESENCE / PRESENCE** |
| Final URL | Amazon listing `dp/B0GTQ5563H` with the Amazon Attribution tag (`maas_adg_E0EA…`) — **byte-identical to the live NIR Device campaign's ads** |
| Tracking | AdKit auto UTM suffix (`utm_source=google&utm_medium=cpc&…`) |

## Structure

| Ad group | ID | Keywords | RSA |
|---|---|---|---|
| Tired - Low Energy | `198831630895` | 17 (12 phrase + 5 exact) | `817597334132` |
| Lack of Sunlight | `200063327242` | 11 (7 phrase + 4 exact) | `817597362860` |
| Sun Lamp Alternatives | `195724914862` | 14 (8 phrase + 6 exact) | `817597377977` |

- 42 keywords total, zero overlap with the existing `NB | NIR Device` campaign (that one owns
  red-light/infrared/light-therapy category terms; this one owns the problem/symptom side).
- Shared negative list `12159530065` — 76 phrase negatives — attached (solar/garden junk, plants/pets,
  medical conditions, supplements/stimulants, lyrics/reddit junk, bulbs, competitor brands, vitamin d).
- Extensions at campaign scope: 6 callouts + 1 structured snippet (Types). All claims reused from
  already-approved ads in the account (free delivery / 30-day returns / patented / $249).

## Landing-page decision — direct to Amazon (Nick, Jul 19)

Ads go **straight to the Amazon listing**, on the same maas-tagged URL the live NIR Device campaign
uses. Verified by read-back: all five ads across both campaigns now share the identical string.

Rationale: one consistent Amazon Attribution destination across the account, and a destination already
proven through policy review. Mid-build the URLs were briefly pointed at `us.sunbooster.health/amazon`
(the tagged PDP lander) — **no spend occurred at that URL**; reverted on instruction before traffic.

**Consequence to carry into reporting:** Google's conversion column will read **0** for this campaign.
Every conversion action in the account is legacy EU (sunled.health, EUR) web tagging, and the purchase
now happens entirely on Amazon. Judge this test on **clicks / CTR / CPC in Google + Amazon Attribution
on the Amazon side**. If a Google-side signal is ever wanted, the `/amazon` lander is the lever — it
fires `add_to_cart` against `AW-11502363411`.

## Policy events during build

- `morning light therapy` **rejected** — Google classifier `BIRTH_CONTROL` (reads "morning" as
  morning-after pill). Exemptible only in the UI; dropped and batch republished. Fun fact for the call.
- `sunlight deficiency` published in a solo batch as a canary — **passed**.
- All 3 RSAs `pending_review` at launch (normal). **Check Sun/Mon that they flip to approved** —
  this account's old 2025 "sunlight" campaigns carry disapproved ads, so don't assume.

## Deliberately excluded keyword families (tell the client — this is the rigor)

1. **vitamin d lamp family** (~11K searches/mo combined) — SunBooster is 850nm NIR; **no UVB means no
   vitamin D synthesis**. Buying that intent would be dishonest and would tank on the listing.
2. **sad lamp / seasonal depression / sun lamp for depression** (~7K/mo) — medical-condition territory;
   account has past disapprovals on old sunlight campaigns. Also negatived.
3. **Sleepy cluster** ("why am i so sleepy", ~10K/mo) — sleep-disorder adjacency, weak product fit.
4. **Competitor conquesting** (verilux 5.4K, philips wake up light 1.9K, sperti 1.3K) — clean phase-2
   test if Low Energy reads well; currently negatived to keep this test readable.

## What stays manual / known limitations

- **Conversions will read 0 in Google** — see the landing-page section. Report on clicks/CTR/CPC plus
  Amazon Attribution. Optional upgrade: mint a **per-campaign** Amazon Attribution tag in the Amazon
  Ads console and swap it in, so this test gets its own Amazon-side line rather than sharing the NIR
  Device campaign's tag (today both campaigns report through the same `maas_adg_E0EA…` tag, so
  Amazon-side numbers are not separable by campaign).
- Campaign-level conversion goals & any policy exemption appeals: UI only.
- Account has junk PRIMARY conversion actions (e.g. a sunled.health page-view). Doesn't affect Max
  Clicks, but worth demoting before any Smart Bidding move.

## Week-1 watch list

1. **Search terms daily** — Max Clicks with no cap + phrase match will wander; feed junk into shared
   list `12159530065`. Watch `happy light` and `sunlight lamp` (the volume drivers) closest.
2. **CPC drift** — no ceiling by design; if avg CPC runs past ~€2 with weak Amazon attribution, add a
   portfolio ceiling.
3. **Budget split vs the NIR Device campaign** — that one was 52% budget-limited at ~€26/day; if Low
   Energy wins on CTR/CPC, rebalance.
4. After ~2 weeks: move winner ad groups toward Max Conversions once an Amazon-click conversion or
   Attribution-informed value model exists.

## Files

- `config.json` — the reviewable spec (keywords + volumes, ads, negatives, exclusions with reasons).
- `keywords-tuesday.md` — the client-facing keyword list for the Tuesday call, incl. Amazon PPC
  translation.
