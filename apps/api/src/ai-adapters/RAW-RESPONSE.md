# Unwired legacy successful-response capture

`raw-response.ts` exports `captureLegacyAiResponse`, an opt-in helper for an
**already obtained WHATWG `Response`**. Nothing imports it into application
composition. It performs no fetch/network access, service startup, bundle loading,
persistence, worker action or public HTTP/error projection. It reuses
[`legacy-validation.ts`](./legacy-validation.ts) without copying schemas or source
guards. This is preparation for the legacy 1.0.2 inspect/extract boundary only.

The caller supplies the existing verified/compiled boundary, authoritative
operation, original request and expected mode. The helper does not infer source,
document revision, job, claim, authorization or workflow semantics. `mock` and
`live` are legacy header labels; successful validation of either label establishes
no live AI behavior, accuracy or production readiness.

```typescript
const validated = await captureLegacyAiResponse({
  boundary, // existing createLegacyAiValidationBoundary(trustedBundleBytes) result
  response, // untouched WHATWG Response obtained by the caller
  operation, // authoritative 'inspect' or 'extract'
  request, // original canonical 1.0.2 request
  expectedMode, // explicit 'mock' or 'live'
  maxBytes, // explicit positive safe integer; caller's body-byte budget
  readTimeoutMs, // explicit positive safe integer; caller's total read budget
})
// Existing result: { body, mode, orchestrationBinding: 'pending' }.
```

Only status **200** is accepted, rather than every `response.ok` status. The media
type must be `application/json`, with an optional `charset=utf-8` parameter
(case-insensitive; quoted UTF-8 and HTTP whitespace accepted). Missing types,
other media types including `+json`, unsupported charsets, unknown/duplicate
parameters and comma-joined duplicate Content-Type values fail closed. No content
sniffing or Content-Length trust is used.

The native Headers API captures `X-AI-Mode` separately from the body and passes its
value unchanged under the lowercase `x-ai-mode` key to the existing validator.
WHATWG Headers already trims surrounding HTTP whitespace and joins repeated
values. The helper does not split, choose or repair them: equal duplicates become
`mock, mock` and fail existing validation. A JSON `mode`/`headers` field cannot
supply or override this binding. All parsed keys are passed to canonical
validation; unexpected body/nested keys are rejected there, never removed.

The body is consumed once through a reader, counting actual delivered bytes before
decoding each chunk. Exactly `maxBytes` is allowed, and a valid JSON prefix is
insufficient until end of stream. Fatal streaming UTF-8 decoding preserves
multibyte characters across chunks and rejects invalid/truncated sequences.
`JSON.parse` rejects malformed JSON and trailing input; a UTF-8 BOM is preserved
and rejected. Parsing uses standard JavaScript JSON semantics (including its
number representation and last-value handling for duplicate JSON member names);
this helper adds no alternate JSON parser or schema dialect.

There are **no default limits** and no business quota or retention choice.
Options and bindings are captured at entry so reassigning caller option properties
during a pending read cannot raise the validated byte cap or replace the bindings.
The original request object remains a caller-owned reference and must stay stable.
`readTimeoutMs` is limited to `2_147_483_647` ms to avoid native timer overflow.
The monotonic deadline covers the entire stream-read phase, including continuously
arriving/empty chunks; it does not reset per chunk. It is a technical caller
budget, not a job timeout, retry rule or workflow transition. It does not preempt
synchronous JSON parsing/validation, a blocked event loop, or arbitrary source code
that synchronously blocks inside a stream callback. `maxBytes` bounds accepted
body bytes, not total process memory: a source may allocate/enqueue an oversized
chunk before it can be rejected, and decoded strings/parsed objects have overhead.

On status/media/size/deadline/read/decode/parse/validation failure, cancellation is
attempted and an acquired reader lock is released. Cancellation is best effort
and never awaited, so a broken/hanging cancellation hook cannot extend the read
deadline. No source error or payload is supplied as a cancellation reason.
Closed/errored streams may already be terminal and cannot invoke their underlying
cancel hook. Missing, consumed or externally locked bodies are rejected; another
reader's ownership is respected. Invalid configuration is rejected before body
consumption or cancellation. No clone, tee, body replay or network abort controller
is created; cancellation does not promise remote work has stopped.

Capture errors are `LegacyAiResponseCaptureError` with fixed messages and codes:
`INVALID_CAPTURE_CONFIG`, `INVALID_RESPONSE`, `UNEXPECTED_STATUS`,
`INVALID_CONTENT_TYPE`, `BODY_UNAVAILABLE`, `BODY_TOO_LARGE`,
`READ_DEADLINE_EXCEEDED`, `BODY_READ_FAILED`, `INVALID_UTF8`, `INVALID_JSON`,
`VALIDATION_FAILED`. They contain no response, raw bytes, URL, header values,
request, parser/source exception or cause. Existing `LegacyAiValidationError`
instances pass through unchanged, retaining the existing bounded sanitized
violations. No mapping to public HTTP responses is provided.

Success returns the existing validator's result directly. Its body is the same
parsed object given to validation, with diagnostics, provenance, pages, fields,
evidence and nullable values preserved. It is neither frozen nor retained here;
the caller owns subsequent consumption and must not mutate it before use.

From the repository root, run only the focused synthetic suite after compilation:

```powershell
pnpm api:build
node --test apps/api/test/ai-response-capture.cjs
```

The suite executes compiled TypeScript with actual WHATWG Response/Headers/
ReadableStream instances and canonical synthetic examples. It covers transport
capture risks and delegation, without duplicating the existing validator suites.
No live service, production write, worker, frontend, SQL or contract change is
part of this preparation. Authentication, authoritative request sourcing,
orchestration, persistence and approved public mappings remain owner bindings.
