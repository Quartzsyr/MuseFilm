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
- Edit `email-content.js`, `community.js`, `mail-automation.js`, `dashboard.js`, `admin.html` and `admin-client.js`, then run `node scripts/bundle-community.mjs`. The generated region is embedded in `worker.js` so Cloudflare Quick Edit can deploy one module while preserving bindings and secrets.
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

Actions posts the signed release feed directly to `https://musefilm-feedback-api.syrquartz.workers.dev/api/releases/check`, while requesting the canonical OIDC audience `https://api.musefilm.top/api/releases/check`. This keeps machine requests independent of browser challenges on the public domain without changing website security rules or weakening token verification. Keep the Worker's `workers_dev` origin enabled. Anonymous requests to this endpoint must return JSON `401 invalid_release_identity`.

Subscribers retain a set of downloaded platforms; users with both installers may receive both groups. Only `subscribed` and non-suppressed contacts are included. Manual mail requires a tested draft and confirmed recipient count. A scheduled send snapshots the audience when confirmed; it re-checks consent/suppression at actual dispatch. Times are stored in UTC and displayed in the administrator's local timezone. Cancel is available before dispatch starts. Closing the browser does not stop server processing.

Temporary SMTP failures are attempted at most four times, with delays of 5 minutes, 30 minutes and 2 hours. Permanent authentication/content errors need administrator attention. Unknown-mailbox RCPT errors with an address-related enhanced status suppress that address. A connection lost after DATA, or an expired delivery lease, is `uncertain` and never automatically resent. The admin retry button only retries failures known safe to resend. `sent` means SMTP accepted the message, not proven inbox delivery.

QQ IMAP uses verified TLS to `imap.qq.com:993`, the same `SMTP_USER` (default `FEEDBACK_TO_EMAIL`) and existing `SMTP_PASSWORD` authorization code. Enable IMAP/SMTP on that QQ account. It uses `EXAMINE` and `BODY.PEEK`, never marks mail read or deletes mail. It searches the last 30 days for report/mailer-daemon/postmaster candidates, reads at most three bounded reports per check, and persists UIDVALIDITY/cursor/deduplication. Only structured RFC 3464 reports matching this site's exact Message-ID and recipient are applied. Final failures suppress further campaigns and thank-you mail; delayed reports are logged without resending. Unmatched/nonstandard reports require manual review in QQ. The database stores delivery diagnostics, not raw mailbox bodies or unrelated mail. `IMAP_AUTH_REJECTED` requires checking QQ IMAP enablement and authorization code; never paste the code into source or logs.

Admin “自动寄信” provides release/IMAP settings and last-check errors, suppression restoration and bounce history. “更新与新闻” provides platform selection, local scheduling, cancellation, per-recipient status and attempt history. Restoring suppression does not subscribe an unsubscribed address or resend old campaigns.

Run `node --test tests/mail-automation.test.mjs tests/community.test.mjs` for queue, scheduling, platform grouping, retry safety, DSN/IMAP parsing and OIDC tests. The local preview captures all mail in `/tmp/musefilm-community-preview-mail.json` and never sends it.

## Simplified dashboard (2026-10-20)

The dashboard now has Overview, Mail, Subscribers, Activity and Automation views. Overview reads durable visit totals, 30-day download clicks, eligible subscribers, queue state and seven-day traffic from D1. Subscriber platform/status/search filters also apply to CSV export. Feedback handling supports new, reviewing, resolved and archived states. These changes use the existing schema.

“检查并发送” saves the current title/body/audience, previews exact eligible recipients, offers an owner test if needed, then confirms immediate or scheduled sending. Unchanged saves retain test validity; content or audience edits invalidate it. Draft versions are checked on save, test completion and start, so an old tab or preview cannot overwrite or send a newer draft. Errors explain the missing step, and buttons recover after failures.

`node scripts/bundle-community.mjs` embeds the standalone client and dashboard handlers in the deployable Worker. Run `tests/dashboard.test.mjs` alongside the community and automation suites. The local development server seeds clearly marked demo data, captures all email locally, and simulates release/IMAP checks without contacting external services.

## Reliable release checks (2026-10-21)

The Worker checks the GitHub Releases API with its own ETag. If the API rejects the shared Worker egress, times out or returns invalid data, it reads the fixed repository-owned `https://raw.githubusercontent.com/Quartzsyr/MuseFilm/main/releases.json` snapshot. Snapshots must identify this repository, have schemaVersion 1, retain numeric GitHub release IDs and installation assets, and be no more than three hours old. API ETags are never reused for snapshot requests. Source failure never clears the baseline or deduplication history.

The notify workflow retrieves release metadata using its existing short-lived GITHUB_TOKEN inside GitHub Actions, filters out drafts and unrelated API fields, then posts public metadata to the existing release-check endpoint. Only the existing workflow's verified GitHub OIDC identity can push a feed; no GitHub API token is sent to Cloudflare. Published/edited releases trigger this immediately, with a five-minute Actions schedule covering delayed assets and missed events. GitHub can delay scheduled jobs. The Worker cron continues its five-minute checks, with the hourly authenticated public snapshot as another fallback. No new secrets or database migration are required.

Both input paths use identical numeric release/platform/preview keys, so switching sources does not resend historical notifications. First checks establish a baseline, paused notifications remain paused, and preview settings are honored. Expired, wrong-repository or legacy snapshots without release IDs fail visibly instead of silently disabling checks.

## Weekly operations, follow-ups and release review (2026-10-21)

Apply `migrations/20261021-operations.sql` before this Worker. The migration is additive and idempotent. Subscription status triggers record future subscribe/resubscribe and unsubscribe transitions; existing historical transitions are not invented. The existing one-minute Worker cron drives these workflows without a browser or Codex desktop automation.

Defaults are enabled weekly owner reports on Monday 09:00 Asia/Shanghai, enabled feedback follow-ups seven days after the first post-activation download, and new-release review mode (`draft`). Existing release/preview switches are retained. New releases generate platform-specific branded drafts from their published notes; the creator must preview/test/confirm sending. Automatic sending remains selectable. Existing dedupe markers are preserved and historical releases are not backfilled. The manual platform draft buttons can create/reopen the latest release's review draft without sending mail.

Weekly reports cover the seven days ending at the configured local scheduled time and aggregate visits, download clicks/platforms, subscription changes, new feedback and current outstanding feedback. They go only to FEEDBACK_TO_EMAIL. A unique calendar-week key prevents duplicate reports when schedules change; temporary SMTP errors retry with the existing 5m/30m/2h policy, and ambiguous submissions are never resent. Test reports and previews use the last seven days and do not consume a scheduled report. Delivery history is shown in Automation.

A follow-up is queued at most once per subscriber and uses the existing campaign delivery queue, retries, branded template and unsubscribe link. Both queueing and dispatch exclude unsubscribe/suppression, and dispatch rechecks website feedback or the workflow being disabled. Already submitted website feedback is matched by normalized email. Ordinary replies to QQ are not read by the DSN-only IMAP check. Pre-activation downloads are excluded.

Settings and preview/test/draft endpoints live under authenticated, origin-checked `/api/admin/workflows`. No new service, secret, subscription or external AI model is required; release summaries are derived deterministically from the actual release notes.


### 统一会员管理

网站管理入口为 `https://api.musefilm.top/admin#membership`，使用原有的邮箱验证码登录。会员服务的旧管理入口跳转到此页面，用户兑换码领取链接保持可用。

兑换码批次支持查看列表、复制可用码列表和导出 TXT，默认按批次原顺序显示 `1. 兑换码`、`2. 兑换码`，每个码单独一行，只包含可领取的码。取消「包含序号」可切换为纯码；复制与 TXT 导出跟随当前显示格式，不含标题或领取链接。每行还可单独复制兑换码或领取链接；CSV 继续包含完整库存、状态与链接。退出或离开页面会清空明文列表。

网站 Worker 通过 `MEMBERSHIP` Service Binding 调用独立会员服务。`MEMBERSHIP_ADMIN_TOKEN` 是网站 Worker Secret，取独立会员服务现有的 `ADMIN_TOKEN`；凭据仅存在服务端，不进入浏览器。所有代理操作继续校验 HttpOnly 站长会话和同源 Origin，且只允许预定的管理接口。

「会员与充值」集中展示账号、核验订单、到账提醒、兑换码、爱发电关联审核和底片漂流举报。到账提醒按真实订单去重，旧历史及零元兑换不补发，无法确定投递结果的邮件需人工核实再重试。漂流举报支持查看副本、移除副本或暂停后续漂流，不影响账号会员权益。

修改模板后运行 `node scripts/bundle-community.mjs`。验证：`node --test tests/community.test.mjs tests/dashboard.test.mjs tests/membership-admin.test.mjs tests/email-images.test.mjs`。

## 账号会员管理（2026-10-25）

部署会员 Worker 前执行 `membership-server/migrations/20261025_account_management.sql`。在「会员与充值 → 账号资料 → 管理账号」按已有账号授予 Plus / Pro，可选择 1–3660 天或永久；保存会替换该档的手动赠送。取消只撤销手动授予，保留其他档位、购买与兑换权益。兑换续费独立于手动赠送，避免把可撤销的永久赠送转移到兑换码权益。

封禁立即删除服务端会话、解除设备授权、使待用登录码和 OAuth 状态失效，并撤回等待中的漂流副本；阻止后续登录及在线账号服务。解封后需重新登录，原有有效权益继续可用。已有离线签名租约最长 7 天，到期前无法远程撤回；客户端联网刷新时同步会员变更，收到 401 时清除本机账号授权。旧客户端可能把永久期限显示为 9999 年，但会员功能正常；后台明确显示「永久会员」。

每次管理操作要求填写原因，记录目标账号、档位、期限、时间与原因；按账号版本原子更新，旧页面提交返回 409。管理员身份仅经网站 HttpOnly 会话及固定服务绑定授权，管理密钥不发送到浏览器。页面离开或退出时清空账号明细。

## 全来源期限与客户端消息（2026-10-25）

先执行会员库迁移 `membership-server/migrations/20261025_member_overrides_messages.sql`。会员期限读取统一通过 `member_effective_entitlements` 视图，人工调整单独保存在覆盖表；购买/兑换原始记录保留。平台同步、恢复购买和退款记录不会悄悄清除人工调整，管理员可逐条「恢复原值」。账号详情还展示试用、已激活创作券及 Plus 赠送窗口，支持指定新到期时间、设为永久或取消，均校验账号 revision 并记录原因。

「客户端消息」支持 Toast / Alert、单账号、全部正常账号或按有效订阅档位发送。预览只保存草稿；确认人数后才原子固定收件账号。重复提交不重复发送。封禁账号不接收，新注册账号不补发已发送群发消息。消息 1–30 天有效，支持撤回、按账号统计展示回执。没有任何自动测试消息投递到正式用户。

消息需要会员版 4.6.0（build 60）及以上。应用启动、切回前台和前台联网期间约每分钟同步；Toast 约 6 秒自动关闭，Alert 顶部横幅保留至关闭或失效。回执按账号及设备隔离，本机保存有限的展示标识以重试回执但不重复 Toast。切换账号、退出登录会清空当前消息；过期和撤回的已知消息在下一次同步移除。新客户端会比较账号管理版本并刷新签名权益；离线许可最长 7 天的边界不变。


## 下载与 IP 防护（2026-10-29）

后台 `/admin#security` 可设置滚动下载配额（默认同一 IP 30 分钟 3 次、24 小时 10 次），支持 IPv4/IPv6，所有浏览器和安装包合并计算。仅信任 Cloudflare 的连接 IP。新增迁移为 `migrations/20261029-ip-security.sql`，可以重复执行，历史下载也计入配额。

在活动记录点击「管理 IP」，或在防护页面输入 IP，可以定时封禁、发送全屏锁屏消息和解除限制。消息为纯文字，最长 2000 字；两种限制都会拒绝下载、反馈等站内接口。页面打开时每约 10 秒轮询 `/api/access`，回到前台立即重查；解除或到期后恢复。后台和退订入口保留访问，管理操作有历史记录。

前端先等待下载授权成功，超额、封禁或网络错误均不会打开安装包，重复事件不会再次打开下载。GitHub Releases 安装包仍是公开资源，站外直链不能由本站接口封禁。刷新网页也不能撤销已开始的下载或控制浏览器之外的操作。部署前已打开的旧页面须刷新才能获得新的轮询逻辑。

发布时同步 `site.js`、`site-access.js`，并更新 HTML 中脚本版本参数。Worker 的模块入口依赖 `ip-security.js` 与 `membership-admin.js`；现有连接、邮件配置及定时任务保持不变。
