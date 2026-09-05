# FaceReveal — conversion demo

A mobile-first web prototype for testing this funnel:

`Ad -> selfie upload -> scan animation -> locked curiosity result -> $9.99 offer -> unlocked demo -> share`

## Demo behavior

- Photo selection and preview work.
- The photo stays local in the browser; this version does not upload it to a server.
- File validation supports JPG/PNG/WEBP up to 10 MB.
- Consent is required before the scan flow starts.
- Scan animation and progress states work.
- The paywall previews a hidden score and visual-vibe match.
- The $9.99 checkout button is intentionally non-charging in demo mode.
- “Preview unlocked result” opens the full result without payment.
- Share creates a 9:16 result image when the browser supports file sharing, with text/clipboard fallback.
- Result values are deterministic demo placeholders based on file metadata. They are not biometric analysis or objective attractiveness ratings.

## Run locally

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## Production work before charging customers

1. Server-side payment flow (Stripe Checkout/Payment Element) with webhook-confirmed purchases.
2. A reviewed AI/photo-analysis approach that does not make unsupported claims.
3. If real celebrity matching is used, separate legal/privacy review and licensed/approved data sources.
4. Temporary private storage with automatic deletion and explicit retention policy.
5. Privacy policy, terms, consent copy, and applicable U.S. state privacy/biometric-law review.
6. Analytics events: `landing_view`, `upload_started`, `photo_selected`, `analysis_started`, `analysis_completed`, `checkout_clicked`, `purchase`, `share_clicked`.
7. Meta/TikTok purchase-conversion tracking only after the real checkout exists.

## Suggested first pricing test

- Core reveal: $9.99 one-time.
- Later A/B test: $7.99 vs $9.99 vs $14.99 bundle.

## First KPI dashboard

- CTR / CPC
- Landing -> photo-selected rate
- Photo-selected -> analysis-completed rate
- Paywall -> checkout-start rate
- Checkout-start -> purchase rate
- CAC
- Revenue per visitor
- Share rate
