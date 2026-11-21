# Droxion Meet — interactive concept preview

Standalone mobile-first front-end at `projects/droxion-meet/`. This prototype is **not a live dating service**.

## Included
- Responsive welcome page and illustrated fictional demo profiles.
- Adult 18+ self-attestation gate (NOT identity or age verification).
- Discovery mode + approximate-distance demonstration, like/skip, simulated matches, local demo chat notes, suggested public meetups.
- Demo-only block/report features, local profile preferences, reset controls.
- Zero third-party scripts, no external API, no telemetry, no photos uploaded.
- No persistent storage; all state disappears on page reload.
- No location/geolocation, real users, real messages, accounts, billing or moderation backend.

## Run
Serve this directory with any static server: `python -m http.server 8000 --directory projects/droxion-meet`. Open http://localhost:8000. No build dependencies.

## Scope and safety
Publicly hosted demo profiles are fictional and clearly labeled. The 18+ checkbox is for demonstration only; **do not invite real dating users or present age verification as implemented**.

Before a production social/dating launch: legally review location/age/privacy requirements, implement genuine age assurance, authentication and account deletion, verified consent/mutual messaging, abuse controls and rate limits, reporting/moderation workflows, image scanning, data retention, safe profile visibility, platform policies, accessibility, abuse testing, and insurance/terms. Evaluate existing dating-app market saturation.

## Business
No payments, monetization, legal work authorization, or user acquisition is handled by this prototype. DroxionClips remains separate and untouched. Suggested subdomain `meet.droxion.com` is not configured.
