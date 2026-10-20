# MuseFilm feedback and analytics Worker

This Worker adds durable feedback, privacy-conscious visit records, optional
Turnstile verification, and email notifications while the website itself stays
on GitHub Pages.

Current production Worker:
`https://musefilm-feedback-api.syrquartz.workers.dev`

## Data behavior

- Page views store only a salted daily IP hash, not the raw IP or full user agent.
- Download clicks separately store the connection IP, approximate Cloudflare country/region/city, OS/browser, user agent, installer/version, source domain and timestamp for owner notifications. The footer Privacy terms dialog explains these records, owner email notifications and the direct GitHub Releases route.
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

## Download email and subscriber dashboard (2026-10-20)

- Apply `migrations/20261019-download-community.sql` before deploying this version. All statements are additive and can be reapplied.
- Edit `community.js`, `mail-automation.js`, `dashboard.js`, `admin.html` and `admin-client.js`, then run `node scripts/bundle-community.mjs`. The generated region is embedded in `worker.js` so Cloudflare Quick Edit can deploy one module while preserving bindings and secrets.
- The creator dashboard is `/admin` on the API Worker. `https://musefilm.top/admin/` redirects there. Login codes go only to the existing `FEEDBACK_TO_EMAIL`; codes expire after 10 minutes and are single use. Sessions use secure HttpOnly cookies and expire after 12 hours. No administrator password or session token is exposed in site assets.
- Downloaders can skip email entirely. The current dialog states that submitting an email subscribes to updates and news. Submission with disclosure version `2026-10-20-email-subscription-v2` immediately creates `subscribed` and records consent and subscription timestamps; no email confirmation is needed. Cached legacy clients retain their original contact/pending behavior. Existing records are not bulk-enrolled. Campaigns exclude contacts, unconfirmed addresses and unsubscribed addresses, and re-check consent before each delivery.
- Configure `SMTP_USER` with the sending QQ address (defaults to `FEEDBACK_TO_EMAIL`) and save the QQ SMTP authorization code as the encrypted `SMTP_PASSWORD` secret. This is an SMTP authorization code, not the QQ account password. The Worker connects to the fixed `smtp.qq.com:465` host using TLS with certificate verification and sends UTF-8 MIME. The existing restricted Cloudflare EMAIL binding continues to send owner notifications and login codes. Credentials are never stored in subscribers, public assets, source code or logs.
- The optional local Agent Mail CLI is separate from server SMTP. CLI OAuth credentials remain on the local machine; they are not copied into Cloudflare or published.
- The dashboard supports subscriber search, status filters, CSV export, owner suppression, download records, draft editing, branded previews, owner test emails, exact recipient-count confirmation and delivery progress. Edits invalidate a draft's previous test. Server-side processing continues after the browser closes. Unknown in-flight deliveries are not retried automatically.
- Thank-you delivery and SMTP errors are recorded in `subscriber_mail_log`; repeated downloads are consolidated per address/day, while a newly requested subscription can send its confirmation separately. Owner and visitor emails are separate, and visitor emails do not contain the download's IP/device records.
- For a local preview with captured fake email only: `MUSEFILM_ASSET_ROOT=/path/to/site node scripts/dev-community.mjs`. It binds only 127.0.0.1:8787, seeds example.test addresses in memory and writes test emails to `/tmp/musefilm-community-preview-mail.json`. No real message is delivered.

## Release mail automation (2026-10-20)

Apply `migrations/20261020-mail-automation.sql` before deploying the bundled worker. It is additive and may be repeated. Rebuild `worker.js` with `node scripts/bundle-community.mjs` after editing `community.js`, `mail-automation.js` or `admin.html`.

Keep the existing daily cleanup cron `17 3 * * *`, and add `* * * * *`. The minute job dispatches up to two recipients per run, checks GitHub releases every five minutes, and checks QQ IMAP approximately every five minutes. Check `mail_settings.last_tick_at` / the admin “自动寄信” screen after deployment. The first release scan establishes a baseline and sends no old releases. Pausing automatic release mail records newly seen releases without backfilling them on resume. Draft releases are ignored; prereleases are off by default. A prerelease promoted to stable is a separate notification.

`.github/workflows/notify-release-subscribers.yml` triggers a release check immediately after release publication/edits and supports manual dispatch. It uses a short-lived GitHub OIDC token; no Cloudflare or SMTP secret is stored in GitHub. The Worker verifies GitHub's RS256 signature, issuer, audience, repository ID/name, workflow path, event and token lifetime, then independently fetches the release list. Replayed triggers cannot create a duplicate release campaign. The periodic scan covers delayed asset uploads and missed workflows. GitHub Actions scheduling, SMTP processing and queue size affect actual arrival time.

Subscribers retain a set of downloaded platforms; users with both installers may receive both groups. Only `subscribed` and non-suppressed contacts are included. Manual mail requires a tested draft and confirmed recipient count. A scheduled send snapshots the audience when confirmed; it re-checks consent/suppression at actual dispatch. Times are stored in UTC and displayed in the administrator's local timezone. Cancel is available before dispatch starts. Closing the browser does not stop server processing.

Temporary SMTP failures are attempted at most four times, with delays of 5 minutes, 30 minutes and 2 hours. Permanent authentication/content errors need administrator attention. Unknown-mailbox RCPT errors with an address-related enhanced status suppress that address. A connection lost after DATA, or an expired delivery lease, is `uncertain` and never automatically resent. The admin retry button only retries failures known safe to resend. `sent` means SMTP accepted the message, not proven inbox delivery.

QQ IMAP uses verified TLS to `imap.qq.com:993`, the same `SMTP_USER` (default `FEEDBACK_TO_EMAIL`) and existing `SMTP_PASSWORD` authorization code. Enable IMAP/SMTP on that QQ account. It uses `EXAMINE` and `BODY.PEEK`, never marks mail read or deletes mail. It searches the last 30 days for report/mailer-daemon/postmaster candidates, reads at most three bounded reports per check, and persists UIDVALIDITY/cursor/deduplication. Only structured RFC 3464 reports matching this site's exact Message-ID and recipient are applied. Final failures suppress further campaigns and thank-you mail; delayed reports are logged without resending. Unmatched/nonstandard reports require manual review in QQ. The database stores delivery diagnostics, not raw mailbox bodies or unrelated mail. `IMAP_AUTH_REJECTED` requires checking QQ IMAP enablement and authorization code; never paste the code into source or logs.

Admin “自动寄信” provides release/IMAP settings and last-check errors, suppression restoration and bounce history. “更新与新闻” provides platform selection, local scheduling, cancellation, per-recipient status and attempt history. Restoring suppression does not subscribe an unsubscribed address or resend old campaigns.

Run `node --test tests/mail-automation.test.mjs tests/community.test.mjs` for queue, scheduling, platform grouping, retry safety, DSN/IMAP parsing and OIDC tests. The local preview captures all mail in `/tmp/musefilm-community-preview-mail.json` and never sends it.

## Simplified dashboard (2026-10-20)

The dashboard now has Overview, Mail, Subscribers, Activity and Automation views. Overview reads durable visit totals, 30-day download clicks, eligible subscribers, queue state and seven-day traffic from D1. Subscriber platform/status/search filters also apply to CSV export. Feedback handling supports new, reviewing, resolved and archived states. These changes use the existing schema.

“检查并发送” saves the current title/body/audience, previews exact eligible recipients, offers an owner test if needed, then confirms immediate or scheduled sending. Unchanged saves retain test validity; content or audience edits invalidate it. Draft versions are checked on save, test completion and start, so an old tab or preview cannot overwrite or send a newer draft. Errors explain the missing step, and buttons recover after failures.

`node scripts/bundle-community.mjs` embeds the standalone client and dashboard handlers in the deployable Worker. Run `tests/dashboard.test.mjs` alongside the community and automation suites. The local development server seeds clearly marked demo data, captures all email locally, and simulates release/IMAP checks without contacting external services.
