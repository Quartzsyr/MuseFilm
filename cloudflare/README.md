# MuseFilm feedback and analytics Worker

This Worker adds durable feedback, privacy-conscious visit records, optional
Turnstile verification, and email notifications while the website itself stays
on GitHub Pages.

Current production Worker:
`https://musefilm-feedback-api.syrquartz.workers.dev`

## Data behavior

- Page views store only a salted daily IP hash, not the raw IP or full user agent.
- Download clicks separately store the connection IP, approximate Cloudflare country/region/city, OS/browser, user agent, installer/version, source domain and timestamp for owner notifications. The website discloses this before downloads and offers a direct GitHub Releases route.
- Visit fingerprints are salted and change every day.
- Each page load counts as a page view, including repeat visits and refreshes. Replayed event IDs are deduplicated. The durable aggregate is initialized from existing recorded events and survives the 90-day event cleanup.
- Visit and download-click event rows are deleted after 90 days by the scheduled Worker. The cumulative page-view counter is retained.
- Download-click emails use `DOWNLOAD_TO_EMAIL` when set, otherwise the existing `FEEDBACK_TO_EMAIL`, and the existing restricted email binding. Send status is stored as sent/failed/not_configured. GitHub completed-download totals remain separate; GitHub does not provide downloader IPs to this site.
- Feedback is rate-limited to five submissions per fingerprint per hour.
- Light-table photographs are never sent to this API.

## Cloudflare setup

1. Create a D1 database named `musefilm-feedback`.
2. Copy `wrangler.example.jsonc` to `wrangler.jsonc` and insert the returned D1
   database ID.
3. Apply `schema.sql` to the production database.
4. Create long random values for `FINGERPRINT_SALT` and `ADMIN_TOKEN` with
   Wrangler secrets.
5. Create a Turnstile widget for `musefilm.top` and
   `quartzsyr.github.io`. Put the public site key in `TURNSTILE_SITE_KEY` and
   save the secret key as `TURNSTILE_SECRET_KEY`.
6. Verify the destination address and enable Email Routing for `musefilm.top`
   in Cloudflare Email Service. Set `FEEDBACK_TO_EMAIL`, set
   `FEEDBACK_FROM_EMAIL` to `feedback@musefilm.top`, and restrict the email
   binding with both `destination_address` and `allowed_sender_addresses`.
7. Deploy the Worker. It can start on its `workers.dev` URL; for the production
   frontend, connect `api.musefilm.top` as a Worker custom domain and keep the
   main site on GitHub Pages.

The site reads the API origin from the `musefilm-api-base` meta tag in
`index.html`. Change that value if the Worker uses a `workers.dev` hostname.

## Private records

The Cloudflare D1 dashboard can inspect the tables directly. The Worker also
provides two private JSON endpoints protected by `ADMIN_TOKEN`:

- `GET /api/admin/stats`
- `GET /api/admin/feedback`

Send `Authorization: Bearer <ADMIN_TOKEN>`. Never put this token in the website
or any public repository.

## 2026-10-19 migration

Before deploying this Worker, apply `migrations/20261019-visit-download-notifications.sql` to the existing database. This creates the durable page-view aggregate, insert trigger and download-click table without replacing existing data. Deploy the Worker while retaining its existing bindings/secrets and then publish the frontend. `GET /api/visitors` now returns `metric: "page_views"` with a non-cached cumulative count. `POST /api/download` accepts only this repository’s installer URLs and the current disclosure version. `GET /api/admin/downloads` requires `ADMIN_TOKEN` and exposes the last 100 download events and delivery statuses. IP locations are approximate and no GPS or precise location is collected.
