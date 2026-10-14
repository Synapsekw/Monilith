# Mono website protocol

`GET /api/mono?action=status` and `POST` actions `chat`, `callback`, and `reset`
retain the existing widget contract. This exact route skips workspace auth in the
proxy and validates its own configured origin, HttpOnly session and `X-Mono-Token`.
All responses are non-cacheable JSON. The Node handler accesses the request, so it
is dynamic without a `dynamic` route option (Cache Components is enabled).

The assistant uses `gpt-6-luna` through Responses with `store: false`, no tools,
strict structured output and a fixed allowlist of links (including relative
`/signup` so preview traffic stays on preview). No API key means guide
status, with no database client or provider request. See `.env.example` for the
server-only configuration names. Bot callbacks and reports each require their
own explicit `true` switch; merely setting bot credentials does not enable them.

Set an exact `MONO_SITE_ORIGIN` for a custom origin or production. Only Vercel
preview deployments can fall back to the platform `VERCEL_URL`; request hosts and
forwarded host headers are never trusted. On Vercel the rate-limit identity uses
`x-vercel-forwarded-for`; elsewhere it conservatively shares an `unknown` bucket.
Vercel documents that header in its [request-header reference](https://vercel.com/docs/headers/request-headers).

Sessions expire after two hours, idempotency records after two days, and rate
records after their bucket plus one day. Reads require a live indexed key and
validate both encrypted and metadata expiry in milliseconds. AES-256-GCM binds
ciphertext to its record address. Origin and encryption secret contribute to the
HMAC namespace, isolating preview/production and invalidating old sessions on key
rotation. Neither raw IPs nor visitor details appear in row keys or metadata.

The dedicated `mono_private_records` table has RLS and no browser policies or
grants. Only the canonical service client calls the invoker read/CAS RPCs. Version
checks atomically serialize rate increments, session locks and request claims
across instances. The `mono-private-records-expiry` pg_cron job deletes at most 100
expired rows each minute using the expiry index, even with no website traffic.
The cleanup function accepts at most 250 rows per call and never touches tenant
records.

When visitors request contact, the model collects only details explicitly supplied
in their messages. Its nullable `contact_draft` contains the seven bounded string
fields `name`, `phone`, `email`, `reason`, `company`, `preferred_time`, and `timezone`;
unknown details stay empty. When callbacks are enabled, that draft becomes the
widget's `contact_request` and remains in saved assistant history, so reconnect
restores the editable review form. Collection never invokes the contact webhook;
only the separate confirmed callback action does, with full contact validation.

Contact delivery is accepted only on the private integration's HTTP 200 contract;
this is never presented as a booked callback. Network ambiguity stays `unknown`.
A pending or unknown request is never sent again, survives conversation reset,
and is recovered through status; another callback ID is blocked while delivery is
unknown. Only a definite rejection can be explicitly retried under its original
ID. If saving an accepted delivery fails, its previously stored pending record
prevents a second provider call. Provider/database diagnostics never reach the
visitor.

Focused verification:

```sh
pnpm exec vitest run --project unit src/lib/mono src/app/api/mono/route.test.ts src/proxy.test.ts --maxWorkers 1
```

The tests use in-memory records and fake network responses. Database permissions,
CAS and expiry/cleanup behavior must also be verified against the additive
migration during integration; never use tenant data for these probes.
