# MuseFilm feedback and analytics Worker

This Worker adds durable feedback, privacy-conscious visit records, optional
Turnstile verification, and email notifications while the website itself stays
on GitHub Pages.

Current production Worker:
`https://musefilm-feedback-api.syrquartz.workers.dev`

## Data behavior

- Raw IP addresses and full user-agent strings are never stored.
- Visit fingerprints are salted and change every day.
- One page view is accepted per visitor, path, and 30-minute window.
- Visit event rows are deleted after 90 days by the scheduled Worker.
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
6. Verify the destination address and sending domain in Cloudflare Email
   Service. Set `FEEDBACK_TO_EMAIL`, `FEEDBACK_FROM_EMAIL`, and restrict the
   email binding to the verified destination.
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
