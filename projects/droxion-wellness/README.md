# DROXION Wellness

Coming Soon storefront and demand-validation dashboard. Three product concepts are seeded in PostgreSQL on first startup. PostgreSQL stores catalog edits, launch-list registrations, product interests, visitor events, uploaded WebP images and owner records. The existing static concept page is the rollback preview.

## Run

Use Node 22+ and PostgreSQL.

```sh
npm ci
npm test
npm start
```

Without a database the server starts with the default catalog and closes signups and owner access. The application runs its schema migration at startup. To test browser behavior against an isolated local PostgreSQL-compatible database, run `CHROMIUM_PATH=/path/to/chromium node browser-check.cjs`. Set `SCREENSHOT_DIR` to capture desktop and phone views.

## Deployment

Use the `wellness-launch-20261125` branch. From the repository root, build with `npm ci --prefix projects/droxion-wellness --omit=dev` and start with `npm start --prefix projects/droxion-wellness`. Check `/healthz` for database connectivity.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string with TLS |
| `NODE_ENV` | Set to `production` to require secure cookies |
| `TRUST_PROXY` | Set to `1` behind a single trusted reverse proxy |
| `ADMIN_PASSWORD_SHA256` | SHA-256 hex digest of a randomly generated 24+ character owner secret |
| `ADMIN_PASSWORD` | Alternate 24+ character secret stored in the platform’s private environment. The hash takes precedence. |
| `UNSUBSCRIBE_KEY` | Stable, random signing key for CSV unsubscribe links |
| `PUBLIC_ORIGIN` | HTTPS deployment origin for unsubscribe links and same-origin form validation |
| `STAGING` | Defaults to `true`. Set `false` after custom-domain and TLS verification to allow search indexing. |
| `SIGNUPS_ENABLED`, `ANALYTICS_ENABLED` | Default to enabled with a database. Set either to `false` to disable it. |

Retrieve only the owner password from the service’s protected Environment screen. The launch list supports consent, interest capture, CSV and signed unsubscribe links. Before sending email campaigns, configure a sender with verified contact details and include each recipient’s unsubscribe link. Set verified contact and social information from the owner dashboard.

## Rollback

Redeploy the previous known-good web-service commit in Render when one exists. The original static preview remains available at `droxion-wellness-preview.onrender.com` and its baseline commit is `52fb13d962ab7d0fbdbcd23eea86b51c74a60bb0`. If routing was changed, restore the saved apex and www DNS records to return traffic to the previous provider. Rolling back application code does not require deleting or resetting PostgreSQL.

Checkout routes are absent in Coming Soon mode. The commerce setting remains locked until a verified payment and fulfillment implementation is added. Formula, safety, and availability details require verified manufacturing information.
