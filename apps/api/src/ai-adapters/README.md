# PH2-A01: unwired legacy AI validation

`legacy-validation.ts` is a pure, opt-in validation boundary for the **1.0.2**
inspect/extract exchange. It has no Nest registration, transport, file access,
environment configuration, persistence, worker or public AIC2 projection.

The caller supplies `VERSION`, `SHA256SUMS` and the six manifest artifact byte
arrays to `createLegacyAiValidationBoundary`. All six hashes are checked against
the supplied manifest **and** the reviewed canonical 1.0.2 hashes, so modifying
both a schema and its manifest fails closed. There is no dynamic schema loader or
arbitrary schema-name API. Fixtures and their separate manifest are test inputs,
not required runtime bundle artifacts. A future bundle version needs Lead review;
this adapter does not authorize contract updates.

`validate({ operation, request, body, headers, expectedMode })` validates both
canonical schemas with existing AJV 2020-12 and ajv-formats dependencies. It does
not coerce, default, remove properties or repair invalid output. Missing or unknown
mode and a mismatch with the caller's explicit mode binding are rejected.
`headers['x-ai-mode']` is the raw `X-AI-Mode` header, separate from the JSON body.
The transport caller supplies lowercase header keys. Only the legacy runner's
`mock` and `live` labels are supported; neither is a production approval.

The source guards mirror inspect/extract checks in
`services/ai/runner/guards.py`: hash/document/case echoes, contiguous pages,
unique evidence IDs, same-document evidence on existing pages and field evidence
references. Declared type need not equal detected type. No extra model-name,
field-registry, quote-content, bbox/precision coupling or upload-size rules are
invented. Diagnostics document references retain their schema-defined freedom.
PaymentCondition is checked only through the existing schema, with no added
policy or claim interpretation. AJV strictTypes is disabled solely to allow the
canonical conditional array subschemas; strict validation and format checks stay
enabled. Schema errors stop at the first violation; source error details are
capped at 20 and exclude payload values. No new payload size limits are imposed.

Success returns the **same body object** with all original fields, evidence,
pages, diagnostics and provenance intact, alongside the unchanged mode and
`orchestrationBinding: 'pending'`. The wrapper is internal validation evidence,
not a public response, readiness decision, immutable snapshot or authorization.
The caller must not mutate a validated payload before consuming it.

The explicit technical interface is bound only to the 1.0.2 schemas:

```typescript
const boundary = createLegacyAiValidationBoundary(bundleBytes)
const validated = boundary.validate({
  operation: 'extract', // or 'inspect'
  request: originalRequest, // ExtractionInput or InspectionInput 1.0.2
  headers: { 'x-ai-mode': rawResponseModeHeader },
  body: parsedResponseBody, // ExtractionOutput or InspectionOutput 1.0.2
  expectedMode: explicitTransportBinding, // 'mock' or 'live'; no default
})
// validated.body === parsedResponseBody; mode stays outside the canonical body.
// validated.orchestrationBinding === 'pending'
```

Opt-in raw successful-response capture now exists in
[`raw-response.ts`](./raw-response.ts), documented in [RAW-RESPONSE.md](./RAW-RESPONSE.md).
It has explicit body/deadline limits and26 focused synthetic tests, and remains
unwired. It does not implement HTTP fetch or an error-envelope/public mapper.

Pending owner bindings: loading trusted bundle bytes; wiring raw response/header capture
before the existing client adds `mode` to its return object; authoritative request
source and expected mode; authentication/ACL and document revision checks;
orchestration, transactions, storage, job/review states and any approved public
projection. Nothing is imported by the application composition. Evaluation is
deliberately unsupported in this preparation slice.

From the repository root:

```powershell
pnpm api:build
node --test apps/api/test/ai-adapter-validation.cjs
```

Tests execute the compiled module using canonical synthetic examples/gold and
in-memory corrupt bundle variants. They do not call or mock AI services and do
not establish AI accuracy, production readiness or orchestration acceptance.
