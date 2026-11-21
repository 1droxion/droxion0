# Droxion Meet — interactive concept preview

Standalone mobile-first front-end at `projects/droxion-meet/`. This prototype is **not a live dating service**.

## Included
- Responsive welcome page and 12 illustrated fictional adult demo profiles with distinct bios, intentions and plans.
- Adult 18+ self-attestation gate (NOT identity or age verification).
- Discovery mode + approximate-distance demonstration, like/skip, simulated matches, interactive rule-based demo-bot conversations with topic-sensitive replies, suggested public meetups.
- Demo-only block/report features, local profile preferences, reset controls.
- Free, Plus ($9.99/month), Premium ($19.99/month) **proposed only**, with non-billing interactive plan selection; no Stripe integration.
- Bots have an unmistakable fictional/demo identity and use topic-aware, rule-based conversational responses in `bot-engine.js`; they are not an LLM or real users. Bots don't exchange real contact info or arrange actual dates.
- Zero third-party scripts, no external API, no telemetry, no photos uploaded.
- No persistent storage; all state disappears on page reload.
- No location/geolocation, real users, real messages, accounts, billing or moderation backend.
- All conversations and selected plan previews exist in browser memory only, not in a database.
- Profiles are synthetic illustrated characters; no images of real people or impersonation.

## Run
Serve this directory with any static server: `python -m http.server 8000 --directory projects/droxion-meet`. Open http://localhost:8000. No build dependencies.

## Scope and safety
Publicly hosted demo profiles are fictional and clearly labeled. The 18+ checkbox is for demonstration only; **do not invite real dating users or present age verification as implemented**.

Before a production social/dating launch: legally review location/age/privacy requirements, implement genuine age assurance, authentication and account deletion, verified consent/mutual messaging, abuse controls and rate limits, reporting/moderation workflows, image scanning, data retention, safe profile visibility, platform policies, accessibility, abuse testing, and insurance/terms. Evaluate existing dating-app market saturation.

## Business
No payments, monetization, legal work authorization, or user acquisition is handled by this prototype. DroxionClips remains separate and untouched. Suggested subdomain `meet.droxion.com` is not configured.

## Private QA member application

The Django app in this directory adds a separate authenticated QA experience alongside the original fictional bot demo. Registration and checkout have no routes. Use synthetic data only.

### Local setup

Use Python 3.12. From this directory:

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
export MEET_LOCAL=1
python manage.py migrate
python manage.py create_qa_member qa-alex
python manage.py create_qa_member qa-jamie
python manage.py createsuperuser
python manage.py runserver
```

Open http://localhost:8000. Sign in to both QA accounts in separate browser sessions and enable visibility under **Edit profile**. The preset QA community and friendship intention let the accounts discover one another. For Windows PowerShell, run `.\.venv\Scripts\Activate.ps1` and use `$env:MEET_LOCAL = "1"`. Run `python manage.py test` and `python manage.py makemigrations --check --dry-run` before deployment.

### Render

Use `projects/droxion-meet/render.qa.yaml` from the QA branch. The template uses a separate free web service and PostgreSQL database. Keep the main domain and existing demo services out of the Blueprint. Confirm the service hostname agrees with `MEET_HOST`. Keep `MEET_LOCAL` unset, set Render-generated secrets and require HTTPS. Access the browser gate using username `beta` and the value of `MEET_BETA_PASSWORD` from the Render Environment screen. Then use a provisioned QA account for member routes. Run the provisioning commands above with the deployment settings and a trusted administrative connection to its database. Free Render PostgreSQL is short-lived. Use this instance for synthetic QA only.

### Implemented in QA

- Django sessions, password hashing and validation, CSRF controls, and authenticated profile editing with visibility off initially.
- Discovery by shared QA community and intention. Interaction state lives in PostgreSQL in hosted configuration and SQLite in local development.
- Mutual likes, pass, block and unmatch. Participant-only messaging with a four-second inbox refresh, persisted history, timestamps, and unread status.
- Activity proposals, recipient acceptance or decline, participant cancellation.
- Member and message reports with copied evidence, admin-only review and resolution, and account deactivation through Django admin.
- Configurable Free, Plus, and Premium daily like limits. There is no billing provider connection.
- Browser-only fictional bot demo. Demo state remains separate from member activity and metrics.

### Launch checklist

Public account creation, email verification and password resets, provider-backed age assurance, location and age filters, moderated private uploads, and billing are future work. The QA community is a manually chosen filter, not a distance measurement. Add a moderation staffing and escalation plan, documented retention and deletion rules, stronger administrator access controls, login throttling, stronger media controls and review, and production monitoring before onboarding real dating users. Validate concurrency, persistence, privacy, accessibility, and recovery in the production database and hosting environment. Obtain legal review of the drafts in `POLICY-DRAFTS.md` and separate payment-provider approval before enabling billing.

### Voice and video calls

A mutual match can place a voice or video call from its conversation. The recipient must accept before media connects. Closing the conversation ends the call. Blocking or unmatching removes call signaling and disconnects the client on its next status refresh. Calls are not recorded. Signaling is temporary and limited to the matching pair.

Local QA allows direct WebRTC for two browsers on the same machine or network. Hosted calling requires `MEET_TURN_URL` (a TURN or TURNS URL) and `MEET_TURN_SECRET` (a shared secret for TURN REST credentials). Configure both in the private Render service environment using a dedicated TURN deployment. Hosted browsers use relay-only ICE. Leave both variables unset until a relay is available. Verify with two provisioned QA accounts on separate networks and confirm permissions, accept, decline, hang-up, and block behavior before inviting testers.
