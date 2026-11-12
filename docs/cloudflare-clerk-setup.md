# Fresh backend setup: Vercel, D1, R2, and Clerk

The code is prepared for a fresh installation. No source data, files, or user
accounts are imported. Vercel continues to host Next.js. Cloudflare runs a small
private D1 gateway; R2 serves media directly; Clerk handles admin sessions.

## 1. Install and configure the local project

Use Node.js 22.13 or newer (Node.js 24 recommended), then run `npm ci`. Copy
`.env.example` to `.env.local`. Leave unconfigured keys blank instead of entering
fake keys. Without backend credentials, public pages use empty content and safe
settings defaults, and admin access fails closed with setup guidance.

Use separate development and production resources and keys. Never commit
`.env.local`, `.dev.vars`, an R2 secret, or the Worker gateway secret.

## 2. Create the D1 database and private gateway

Run these commands from the repository root after creating a Cloudflare account:

```sh
npx wrangler login
npx wrangler d1 create medhaup-content
```

Copy the returned database ID into `cloudflare/d1-worker/wrangler.jsonc`, replacing
`REPLACE_WITH_NEW_D1_DATABASE_ID`. This database ID is not a credential. Keep
the binding named `DB` and the database name `medhaup-content`.

Apply the complete fresh schema:

```sh
npm run db:migrate:remote
```

Generate a random secret locally, save it in a password manager, and use the same
value for `D1_GATEWAY_SECRET` in the Worker and in Vercel. The gateway requires at
least 32 characters. One way to generate it is:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npx wrangler secret put D1_GATEWAY_SECRET --config cloudflare/d1-worker/wrangler.jsonc
npm run db:deploy
```

Set these in `.env.local` and later in Vercel:

```dotenv
D1_GATEWAY_URL=https://medhaup-d1-gateway.YOUR-SUBDOMAIN.workers.dev/query
D1_GATEWAY_SECRET=the-same-secret-entered-above
```

The Worker accepts only authenticated, bounded, parameterized queries from the
Next.js server. It has no browser CORS permissions. The gateway URL and secret
must never use the `NEXT_PUBLIC_` prefix. The public Worker hostname is reachable,
but requests without the secret receive 401; this is an authenticated service,
not a private network connection.

For local D1 development, put the secret in
`cloudflare/d1-worker/.dev.vars` as `D1_GATEWAY_SECRET=...`, run
`npm run db:migrate:local`, then `npm run db:dev`. In `.env.local`, use
`D1_GATEWAY_URL=http://127.0.0.1:8787/query`. HTTP is permitted only for loopback
addresses outside production. Local and remote databases are separate.

## 3. Configure Clerk and authorize an administrator

Create a Clerk application with email/password authentication. Set its access
mode to **Invite-only** so public visitors cannot register. Configure its allowed
domains and sign-in path for the Vercel/custom domain, using `/admin/login`.
Use Clerk's development instance for local development and its production
instance for production.

Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to `.env.local` and
the corresponding Vercel environment. The first is public; the second is private.
The app already configures `/admin/login` and the `/admin` sign-in destination.

Create the first administrator in the Clerk dashboard. Copy that user's `user_…`
ID, then authorize that exact identity in D1. Replace the example ID below:

```sh
npx wrangler d1 execute medhaup-content --remote --config cloudflare/d1-worker/wrangler.jsonc --command "INSERT INTO admins (clerk_user_id) VALUES ('user_REPLACE_WITH_REAL_ID');"
```

For a local database, use `--local` instead of `--remote`. Development and
production Clerk users have different IDs. Creating or inviting a Clerk user
does not automatically grant CMS access. Every admin API checks the live D1
membership record as well as the Clerk session. To revoke CMS access, delete
that user's row from `admins` through your administrative workflow.

## 4. Create two R2 Standard storage buckets

Create `medhaup-staging` and `medhaup-assets` (or use your own names):

| Bucket | Access | Purpose |
| --- | --- | --- |
| Staging | Private; no public domain or r2.dev URL | Temporary unvalidated uploads |
| Assets | Public through an HTTPS custom domain | Validated public images and PDFs |

The two buckets must be different. Add a lifecycle rule to the staging bucket
that deletes objects under `pending/` after one day. Signed uploads expire after
five minutes; this rule also removes objects recreated by a late retry.

Connect an asset domain such as `assets.YOUR-DOMAIN` to the public bucket. Set
`NEXT_PUBLIC_R2_PUBLIC_URL=https://assets.YOUR-DOMAIN` with no query string or
credentials. Use a custom domain in production; `r2.dev` is intended for
development and is rate limited. Public asset URLs remain public when a content
record is unpublished: publishing controls website visibility, not file secrecy.
Do not upload confidential material into the public assets workflow.

Create R2 S3 credentials with object read/write access scoped to these two
buckets. Configure:

```dotenv
R2_ACCOUNT_ID=your-32-character-account-id
R2_ACCESS_KEY_ID=your-access-key-id
R2_SECRET_ACCESS_KEY=your-secret-access-key
R2_STAGING_BUCKET=medhaup-staging
R2_PUBLIC_BUCKET=medhaup-assets
NEXT_PUBLIC_R2_PUBLIC_URL=https://assets.YOUR-DOMAIN
```

Configure staging-bucket CORS for the exact app origin. Replace the placeholder
below; add `http://localhost:3000` only on the development bucket. Add specific
Vercel preview origins when testing previews, rather than allowing every origin.

```json
[
  {
    "AllowedOrigins": ["https://YOUR-APP-DOMAIN"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

Public image display and ordinary download links do not require browser fetch
CORS on the assets bucket. Where available, configure the asset domain to send
`X-Content-Type-Options: nosniff`. Files already carry explicit content types.
The browser supplies the signed Content-Length automatically when uploading the
selected File; do not try to set that forbidden header from browser JavaScript.

Uploads use the sequence: authorize admin → reserve an asset → signed browser
PUT to private staging → server verification → public promotion → save content.
Image uploads are limited to 8 MB and 40 megapixels, decoded and resized to a
maximum 2048 × 2048 bounding box, and converted to WebP. Animated image uploads
produce a still image. PDFs are limited to 25 MB and checked for PDF header/EOF;
this is format validation, not malware scanning. PDF download names are stored
in `Content-Disposition`, so downloads do not stream through a Vercel function.
Image processing still incurs Vercel compute and transfer during admin uploads.

There is an hourly limit of 100 upload reservations per admin. Use the dashboard
**Clean up unused uploads** action to remove unused uploads older than 24 hours.
Each run handles up to 50; repeat if necessary. Shared assets referenced by saved
content are retained. Failed deletions can be retried. Keep the staging lifecycle
rule enabled even when using this cleanup action.
An interrupted completion can leave an unreferenced public object or a processing
record. The cleanup action also recovers these after 24 hours; it does not remove
an upload that is currently being processed.

## 5. Configure Vercel and create the first content

Add all required values from `.env.example` to the appropriate Vercel environment
and redeploy. `NEXT_PUBLIC_*` values are embedded at build time, so changing the
Clerk publishable key or asset domain requires a new deployment. Existing GA4,
app-store, Gemini, and Tavily configuration remains optional and independent.

Sign in at `/admin/login`. Create a batch, blog post, or resource; upload its file;
then publish the record. Collection editing, counts, settings, publishing, uploads,
and deletion all use authenticated server endpoints. Published queries share a
cache and are invalidated after edits. Draft content is never served by public
queries. The fresh site intentionally starts with empty CMS collections; bundled
course copy and local `/resources/` files remain available on Vercel.

Validate these flows with real credentials before production launch:

- An invited and authorized admin can sign in; a signed-in non-admin cannot read
  drafts, upload, edit settings, or mutate content.
- PDF and image uploads work from the real browser origin; an oversized or
  incorrectly typed file is rejected before publication.
- Create, edit, publish, unpublish, and delete update the public website and AI
  retrieval. Blog slugs, settings, pagination, and the empty admission state work.
- PDFs download with the expected filename. R2 images load directly from the
  asset domain, rather than `/_next/image` on Vercel.
- Removing one of two records sharing a file does not delete that shared file.
- Worker requests without the gateway secret return 401.

## Limits and operations

This setup does not guarantee a permanently zero bill. D1 has daily row-operation
limits and a 500 MB free per-database ceiling. The gateway uses Workers requests
and CPU. R2 has free egress but meters storage and operations beyond its included
allowances. Vercel and Clerk have their own limits. Check each provider dashboard
regularly; public files bypass Vercel only when served from R2. Existing bundled
assets and HTML/API responses still use Vercel bandwidth.

Do not enable automatic paid upgrades or extra paid products as part of this
setup. R2 usage over its free allowances is billed without a separate website-plan
upgrade, so monitor storage/operations and remove unneeded assets.

Verification commands (no live credentials required):

```sh
npm test
npm run lint
npx next typegen
npx tsc --noEmit
npm run build
```

Reference documentation: [D1](https://developers.cloudflare.com/d1/),
[R2 signed URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/),
[R2 public domains](https://developers.cloudflare.com/r2/buckets/public-buckets/),
[Clerk Next.js](https://clerk.com/docs/nextjs/getting-started/quickstart), and
[Clerk access restrictions](https://clerk.com/docs/guides/secure/restricting-access).
