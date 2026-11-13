<p align="center">
  <img src="public/logo.png" alt="medhaup" width="160" />
</p>

# medhaup Web Platform

The official web platform for **medhaup**, an education company focused on
nursing exam preparation in West Bengal: the WBJEEB ANM(R) and GNM entrance
course, plus NORCET, RRB Nursing, JENPAS(UG), JEPBN, JEMScN and year-wise ANM, GNM and D.Pharmacy courses. The platform brings together course discovery, admissions, bilingual
learning resources, content publishing, student-success stories, and marketing
measurement in one responsive application.

**Production:** [medhaup.com](https://medhaup.com)

This is a private company repository. It is maintained for medhaup's product,
content, marketing, and operational workflows and is not a personal starter
project.

## Platform capabilities

| Area                  | Capabilities                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Course and admissions | Course information, current-batch availability, app-download links, callback requests, and WhatsApp-assisted admissions                                |
| Learning resources    | Subject syllabi, full syllabus downloads, previous-year papers, current affairs, free resources, educational articles, and page-aware AI doubt support |
| Student trust         | Gallery content and a dedicated wall of student-success photos                                                                                         |
| Store                 | CMS-managed products with WhatsApp checkout hand-off                                                                                              |
| Content operations    | Authenticated admin CMS with draft/publish controls, file uploads, site settings, and collection management                                            |
| Marketing             | GA4 funnel events, 90-day last-non-direct UTM attribution, lead-source capture, and an internal campaign-link builder                                  |
| Search visibility     | Route metadata, canonical URLs, Open Graph images, structured data, dynamic sitemap generation, robots rules, and a web app manifest                   |

## System overview

| Layer            | Technology                                  | Responsibility                                                                  |
| ---------------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| Web application  | Next.js 16 App Router, React 19, TypeScript | Server-rendered pages, client interactions, routing, metadata, and revalidation |
| Design system    | Tailwind CSS 4, Framer Motion, Lucide React | Responsive presentation, motion, and interface icons                            |
| Application data | Cloudflare D1                           | Published content, batches, products, site settings, and admin sessions       |
| Authentication   | Private admin credentials and D1 sessions | Single administrator email/password login                                 |
| File storage     | Cloudflare R2                            | Public images and downloadable PDF resources                                    |
| Lead delivery    | Web3Forms                                   | Contact and admission form delivery                                             |
| Measurement      | Google Analytics 4                          | Funnel events and campaign attribution                                          |

Public content is loaded from D1 through a private Worker gateway. Published
queries share a five-minute cache, invalidated after admin changes. Public pages
retain their route revalidation settings; admin and draft reads are never cached. If a content query fails, the data layer logs the failure and
returns an empty result; content-driven pages then show their configured
"Coming Soon" state. Site contact settings fall back to safe defaults.

## Application routes

### Public website

| Route                        | Purpose                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `/`                          | Company homepage, course highlights, batches, and calls to action                   |
| `/course`                    | Detailed ANM/GNM course information                                                 |
| `/norcet`                    | NORCET exam pattern, subjects, syllabus, eligibility, free resources and enrolment enquiries   |
| `/admission`                 | App-based admission and callback request flow                                       |
| `/syllabus`                  | Subject breakdown and syllabus downloads                                            |
| `/pyq`                       | Previous-year question papers and answer keys                                       |
| `/resources`                 | Free study resources and downloadable material                                      |
| `/current-affairs`           | Daily updates and monthly current-affairs PDFs                                      |
| `/blogs` and `/blogs/[slug]` | Educational article index and article pages                                         |
| `/store`                     | Books, notes, test series, and WhatsApp checkout                                    |
| `/gallery`                   | Classes, toppers, and event photography                                             |
| `/wall-of-success`           | Published student-success photos                                                    |
| `/about`                     | Company and educator information                                                    |
| `/contact`                   | Contact channels, enquiry form, and common questions                                |

### Internal administration

| Route                    | Purpose                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| `/admin/login`           | Single administrator email/password login                                     |
| `/admin`                 | Publishing dashboard and collection status                              |
| `/admin/[collection]`    | Create, edit, publish, unpublish, upload, and delete collection records |
| `/admin/settings`        | Company contact details and social-channel settings                     |
| `/admin/marketing-links` | Standardized campaign URL generation                                    |

Admin and API paths are excluded from indexing through both robots rules and
response headers.

## Repository structure

```text
app/                    Next.js routes, layouts, metadata, sitemap, and manifest
components/
  layout/               Navigation, footer, and shared site chrome
  provider/             Site settings, attribution, and analytics providers
  sections/             Page-level product and content sections
  seo/                  Structured-data rendering
  ui/                   Shared interface components
docs/                   Operational documentation
lib/
  admin/                CMS collection definitions and management interfaces
  auth/                 Password verification and D1-backed admin sessions
  cloudflare/           Private D1 gateway client
  db/                   Parameterized queries and server validation
  storage/              R2 upload verification and asset cleanup
  analytics.ts          GA4 event helpers
  attribution.ts        UTM capture, persistence, and form enrichment
  data.ts               Published-content queries and data mapping
  seo.ts                Canonical metadata and schema helpers
  settings.ts           Site settings, defaults, and derived contact links
public/                 Brand assets and bundled downloadable resources
cloudflare/d1-worker/   D1 Worker, complete fresh schema, and Wrangler configuration
```

## Local development

### Prerequisites

- Node.js 22.13 or newer (Node.js 24 recommended for the local Worker tests)
- npm
- A company-owned Cloudflare account for live backend setup
- Appropriate Web3Forms and GA4 access when working on those integrations

### Installation

From the repository root:

```bash
npm ci
```

Copy `.env.example` to `.env.local`. Follow [the backend setup guide](docs/cloudflare-clerk-setup.md) to fill in the service keys. Public pages can run with empty backend configuration; admin access fails closed until configured. Example configuration:

```dotenv
ADMIN_EMAIL=
ADMIN_PASSWORD_HASH=
ADMIN_SESSION_SECRET=
D1_GATEWAY_URL=
D1_GATEWAY_SECRET=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_STAGING_BUCKET=medhaup-staging
R2_PUBLIC_BUCKET=medhaup-assets
NEXT_PUBLIC_R2_PUBLIC_URL=

# Optional integrations
NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX
NEXT_PUBLIC_APP_STORE_URL=https://apps.apple.com/app/your-app

# Server-only medhaup AI configuration
AI_FEATURE_ENABLED=false
GEMINI_API_KEY=your-private-google-ai-studio-key
GEMINI_MODEL=gemini-3.5-flash-lite
```

Run `npm run admin:setup` to configure the admin email and password privately.
Choose a password with at least 15 characters, or leave it blank to generate one.
The script writes a password hash and a generated session secret to `.env.local`,
preserving existing service settings. It also creates `.env.vercel.auth` for
Vercel import and `.env.admin-credentials` for private owner lookup; all three
files are ignored by Git. Apply the D1 migrations and deploy the gateway as
described in the setup guide before signing in.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

| Variable                        | Required | Purpose                                                                                     |
| ------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET` | For admin | Private single-admin credentials generated by `npm run admin:setup`; never use `NEXT_PUBLIC_` |
| `D1_GATEWAY_URL`, `D1_GATEWAY_SECRET` | For content and admin | Private Worker `/query` URL and shared server secret |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | For uploads | Server-only R2 S3 credentials |
| `R2_STAGING_BUCKET`, `R2_PUBLIC_BUCKET` | For uploads | Separate private staging and public media buckets |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | For media | Public assets HTTPS custom domain; set at build time |
| `NEXT_PUBLIC_GA_ID`             | No       | Enables Google Analytics and the custom funnel-event layer                                  |
| `NEXT_PUBLIC_APP_STORE_URL`     | No       | Enables the Apple App Store action on the admission page                                    |
| `AI_FEATURE_ENABLED`            | No       | Enables the page-aware AI UI when the provider key is configured; disabled by default       |
| `GEMINI_API_KEY`                | For AI   | Private Google AI Studio API key, used only on the server; never prefix with `NEXT_PUBLIC_` |
| `GEMINI_MODEL`                  | No       | Gemini model ID; defaults to `gemini-3.5-flash-lite`                                         |
| `TAVILY_API_KEY`                | For search | Private Tavily API key; ordinary chat works without it; never prefix with `NEXT_PUBLIC_` |
| `AI_MAX_OUTPUT_TOKENS`          | No       | Maximum generated tokens per answer; defaults to `1536`, bounded to `128`–`4096`            |
| `AI_REQUEST_TIMEOUT_MS`         | No       | Combined search and answer timeout in milliseconds; defaults to `30000`                    |
| `AI_MAX_MESSAGE_CHARS`          | No       | Maximum student-question length; defaults to `1200`                                         |
| `AI_MAX_CONTEXT_CHARS`          | No       | Maximum trusted page-context length; defaults to `6500`                                     |
| `AI_RATE_LIMIT_REQUESTS`        | No       | Requests allowed per client IP, server instance, and window; defaults to `8`                |
| `AI_RATE_LIMIT_WINDOW_MS`       | No       | Rate-limit window in milliseconds; defaults to 24 hours                                     |

All `NEXT_PUBLIC_*` values are visible to browsers and are embedded at build
time. Never place service-role keys, database passwords, or other private
credentials in these variables. Environment files are ignored by Git and must
not be committed.

The Gemini adapter calls Google's `generateContent` REST endpoint with a
server-only `x-goog-api-key` header, separate system instructions, and bounded
conversation history. English, Bengali, and common mixed-language indicators of
current information trigger one Tavily Search REST request, including short
follow-ups. Gemini's built-in Google Search tool is never enabled.

Tavily uses `search_depth: "basic"` and `auto_parameters: false` for a predictable
one-credit search, with at most five results. Queries stay under 400 characters;
short follow-ups include the previous question, not the entire conversation or
trusted site context. Result snippets are bounded to 1,200 characters each and
passed to Gemini as untrusted reference data. The UI displays validated HTTPS
source links returned by Tavily, not links invented by the model.
Queries explicitly naming WBJEE/WBJEEB are restricted to `wbjeeb.nic.in` and
`admissions.nic.in`, and queries naming NORCET to `aiimsexams.ac.in` and
`aiims.edu`, to prioritize the responsible exam authority.

The assistant's trusted context tells it on every page that the NORCET course
has course fees and batch details available from the team, and the `/norcet` page
context adds the exam pattern, syllabus, eligibility and any live NORCET
resources so it can answer NORCET questions without inventing details.

Ordinary study questions skip Tavily. Search authentication, quota and network
failures are surfaced without calling Gemini for an unverified current answer.
Empty results explicitly instruct Gemini to say that no usable results were found.
Search and answer generation share one timeout. There are no automatic retries,
extra research/extraction calls, or fallback to Google's paid Search tool.
medhaup-specific claims remain grounded in trusted server context.

Create the key in [Google AI Studio](https://aistudio.google.com/apikey) and set
`AI_FEATURE_ENABLED=true` to enable the assistant. API-key names and project
names/numbers are metadata, not model IDs or credentials. Production also needs
the server-only key in its deployment environment. Create a separate search key
in [Tavily](https://app.tavily.com/) and set `TAVILY_API_KEY` locally and in the
deployment environment (the spelling is `TAVILY`, not `TAVIFY`). Installing a
Tavily editor skill or CLI alone does not configure the website's runtime.
Restart the local server
after updating environment files.

The default is `gemini-3.5-flash-lite`; Google no longer makes 2.5 Flash-Lite
available to new accounts. Gemini text and Tavily Search have independent quotas.
Actual quotas depend on the Google project; check
[AI Studio limits](https://ai.google.dev/gemini-api/docs/rate-limits) and
[Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) before switching
models or billing tiers. Tavily currently includes 1,000 free credits per month
with no card required; basic searches cost one credit. This is a shared allowance
for the website, not a per-student allowance. See
[Tavily credits and pricing](https://docs.tavily.com/documentation/api-credits).
Requests are not automatically retried or routed to paid models when a quota is
exhausted. Provider retry delays are returned to the client, and provider error
payloads and credentials are never logged.

In production the AI trigger is hidden unless both the feature flag and Gemini
configuration are present. The in-memory client-IP limiter remains separate
from both providers' quotas and resets when its server instance restarts.

The Google Play listing is configured in the admission experience. Web3Forms
submission configuration is maintained separately in the admission and contact
form components. Update third-party configuration only through company-owned
accounts and verify both forms after any change.

## Backend provisioning

Follow [Cloudflare D1, R2, and admin login setup](docs/cloudflare-clerk-setup.md).
This is a fresh installation: content starts empty, and files are uploaded anew.
The checked-in D1 schema defines all twelve CMS collections, site settings,
admin sessions and login-attempt storage, asset metadata, and file references.

Vercel runs Next.js. An authenticated Worker with a native D1 binding accepts
server-only queries; the browser never receives the gateway secret. Each admin
API checks the administrator's D1-backed session against the current private
authentication configuration. Sessions expire after eight hours; logout revokes
them. Changing the admin email, password hash, or session secret invalidates
existing sessions after restart or redeployment. There is no public registration,
OTP, email service, or external authentication account.
R2 uploads go into a private staging bucket, are validated by the server, and
are then promoted to the public asset bucket. Images are converted to WebP and
served directly from R2; PDFs carry attachment headers.

## Content operations

The CMS is defined in `lib/admin/collections.ts`. It manages store products,
blogs, PYQs, galleries, success photos, current affairs, resources, syllabus
content, and batches.

A standard publishing workflow is:

1. Sign in at `/admin/login` with the configured administrator email and password.
2. Create or edit the relevant record and upload approved assets.
3. Review titles, dates, URLs, downloadable files, and accessible image alt
   text.
4. Use the publish control only when the content is ready for customers.
5. Verify the public route. Allow up to 60 seconds for revalidated pages to
   refresh.

For homepage question-paper downloads, open **Previous Year Papers** at
`/admin/pyq`, choose **Add Paper**, enter the title, year, and language, and
upload the **Question Paper PDF**. An **Answer Key PDF** is optional. Use
**View uploaded PDF** to review each file, save the record, then switch its
**DRAFT** badge to **LIVE**. The same published records appear below the hero
on `/` and in the `/pyq` library. Unpublishing removes a paper from both views
after revalidation. With no published records, the homepage shows an empty
state rather than sample downloads. Uploads use the existing `files` bucket
under `pyq/`; no new database table or bucket is required.

NORCET study material is managed at `/admin/norcet-resources` (**NORCET —
Resources**). Choose a category (Syllabus, Previous Year Papers, Notes, Mock
Tests, Guides), the exam stage, an optional subject, and upload the PDF; the
file size is filled in automatically. Switch the record from **DRAFT** to
**LIVE** to show it in the resources grid on `/norcet`. A live **Syllabus**
item also powers the syllabus download button on that page. With no live
records the page shows a resource enquiry block with an enrolment link; the rest of the NORCET page (exam pattern, subjects, syllabus,
eligibility, FAQs) is code-managed in `lib/norcet.ts`, as is the course availability
state (`NORCET_COURSE.status`). Uploads use the existing `files` bucket under
`norcet-resources/`. Run the checked-in migration
`cloudflare/d1-worker/migrations/0001_fresh_content.sql` on the project
before using the collection.

The NORCET enrolment enquiry form on `/norcet` submits to Web3Forms with
`form_type=norcet_enrolment` and emits a `generate_lead` event with
`lead_type=norcet_enrolment`; no database table is involved.

Global phone, email, address, WhatsApp, and social-channel values are managed at
`/admin/settings`. Code defaults are defined in `lib/settings.ts` and are used
if the settings record cannot be loaded.

## Analytics and attribution

GA4 is loaded only when `NEXT_PUBLIC_GA_ID` is configured. The application
tracks important funnel actions such as lead generation, WhatsApp and phone
clicks, admission intent, app downloads, file downloads, checkout starts, and
verified purchases.

Inbound campaign attribution requires the complete core UTM set:

```text
utm_source + utm_medium + utm_campaign
```

`utm_content` and `utm_term` are optional. Valid attribution is retained in the
browser for 90 days using last-non-direct behavior and is attached to GA events
and Web3Forms submissions. Generate company campaign links through
`/admin/marketing-links`; do not add UTMs to internal navigation.

See [docs/analytics.md](docs/analytics.md) for event registration, GA4 custom
dimensions, campaign conventions, and deployment verification.

## SEO and discoverability

The application provides:

- Shared and page-specific metadata with canonical URLs
- Open Graph and social-card images
- Organization, website, breadcrumb, course, article, and resource schema
- A sitemap containing static routes, published articles, and content images
- Robots rules and `X-Robots-Tag` protection for internal routes
- A standalone web app manifest and branded icons

The production origin is centralized in `lib/seo.ts` and is also referenced by
the sitemap and robots implementations. Coordinate domain changes across all
three locations and validate generated metadata before release.

## Quality checks

Run the complete local quality gate before opening or merging a change:

```bash
npm test
npm run lint
npx next typegen
npx tsc --noEmit
npm run build
```

| Command            | Purpose                                      |
| ------------------ | -------------------------------------------- |
| `npm run dev`      | Start the local Turbopack development server |
| `npm run admin:setup` | Configure private admin credentials and Vercel import files |
| `npm run lint`     | Run the repository ESLint rules              |
| `npx tsc --noEmit` | Perform strict TypeScript validation         |
| `npm run build`    | Create the optimized production build        |
| `npm run start`    | Serve a completed production build           |

Run `node --test scripts/ai-gemini.test.mjs` for the Gemini adapter and route
regression checks, and `node --test scripts/norcet.test.mjs` for the NORCET
data, AI context, admin collection and section rendering checks; they mock
Gemini, Tavily, D1, admin authentication, and R2 and do not consume API quota. Lint,
type-check, build, and focused browser verification remain the release baseline.

## Deployment

Deploy to a platform that supports the full Next.js server runtime and
revalidation behavior. A plain static export is not the expected deployment
model because the application loads changing D1 content on the server.

Before a production release:

1. Configure all required environment variables in Vercel, including the three
   private admin variables from `.env.vercel.auth`, and redeploy after changes.
2. Run lint, type-check, and the production build.
3. Apply `0002_admin_auth.sql` through `npm run db:migrate:remote`, redeploy the
   updated Worker, and verify admin login/logout, Worker authentication, and R2
   bucket access. Remove old Clerk environment variables when upgrading.
4. Smoke-test public content, authentication, uploads, both lead forms, and
   WhatsApp/app links.
5. Verify canonical metadata, `robots.txt`, `sitemap.xml`, and social previews.
6. Validate GA4 events in Realtime or DebugView and confirm UTM values on a test
   lead.
7. Check the primary mobile layouts before promoting the release.

## Engineering and data-handling standards

- Keep customer and student information out of source control, screenshots,
  fixtures, and logs.
- Preserve strict TypeScript and the existing server/client component
  boundaries.
- Enforce server-side admin authorization on every admin API and keep the D1 gateway private.
- Do not expose private keys through `NEXT_PUBLIC_*` variables or client code.
- Preserve draft/publish behavior when adding content collections.
- Update operational documentation whenever analytics events, environment
  variables, routes, or external integrations change.
- Use company-owned accounts for Cloudflare, analytics, forms, domains, and app
  store integrations.

## Ownership

This repository contains company-owned medhaup software and brand assets. No
open-source license is granted. Copying, redistribution, publication, or reuse
outside authorized medhaup work requires written approval.

For product or operational enquiries, contact
[contact@medhaup.com](mailto:contact@medhaup.com).
