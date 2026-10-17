# Document storage preparation — opt-in, unwired

This directory contains only synchronous byte-integrity primitives. It does not
release a document contract or implement a store, write API, vendor adapter,
backend mutation, or worker publication. Main owns composition, bundle wiring
and reporting. Nothing imports these helpers into the running application.

## Implemented technical behavior

`byte-integrity.ts` exports `computeByteIntegrity(bytes, { maxBytes })` and
`verifyByteIntegrity(bytes, { sha256, byteLength }, { maxBytes })`.

- Buffer and Uint8Array inputs hash exactly their byteOffset/byteLength view,
  including binary, NUL and invalid UTF-8 bytes. No decoding or normalization.
  ArrayBuffer, DataView and other typed arrays are rejected. Detached,
  out-of-bounds and shared-memory views are rejected; shared writers cannot
  supply a stable snapshot. Intrinsic view bounds ignore shadowed properties.
- `maxBytes` is mandatory on every call: a nonnegative safe integer with an
  inclusive ceiling. Zero permits only empty bytes. No file-size default,
  page limit, quota or content/type rule is chosen. The ceiling bounds hashing
  of already materialized bytes; ingress/stream allocation limits remain future
  work. Expected length must also fit the supplied ceiling.
- Expected length is a nonnegative safe integer. Expected SHA-256 is exactly
  64 hexadecimal characters, case-insensitive; output is lowercase hex. No
  coercion, whitespace trimming or digest inference. These are internal hash
  representations, not a shared DTO, source identity or storage-key format.
- Verification validates limit and expected metadata, enforces limits, checks
  length, then hashes and compares. Equal length alone is insufficient. Returned
  metadata is frozen. Inputs are never modified or retained.
- `ByteIntegrityError` exposes only a fixed code and fixed message, without raw
  bytes, metadata, paths, original causes or parser/provider details. Codes are
  `INVALID_BYTES`, `INVALID_LIMITS`, `INVALID_EXPECTED_INTEGRITY`,
  `BYTE_LIMIT_EXCEEDED`, `BYTE_LENGTH_MISMATCH`, `SHA256_MISMATCH`, `HASH_FAILED`.
  Public error mapping belongs to the eventual composition/contract owner.

These helpers observe bytes at call time. They do not freeze caller-owned buffers,
authenticate expected metadata, authorize access or prove persistent immutability.
Later buffer mutation requires another check. Expected metadata must ultimately
come from an authorized, immutable binding; recomputing both bytes and their
expected hash does not detect substitution.

## DRAFT internal adapter design — not an approved port

No executable storage interface is proposed here. Before a concrete adapter, the
shared-contract owner must freeze identities and operations together with the
document/source contract described in
[Phase 2 decisions](../../../../docs/implementation/PHASE-2-DECISIONS.md) and
[Phase 1 boundary](../../../../docs/implementation/PHASE-1-CONTRACT-FREEZE.md).
The design must resolve:

- Atomic create-if-absent semantics under concurrent calls and retries; immutable
  object/version identity and exact persisted byte length/SHA-256. Existing
  versions cannot be overwritten; a replacement must preserve readable old
  versions. Hash equality by itself is neither identity nor authorization.
- ACL and upstream binding: server-authorized organization/case/source/version
  references, independently trusted expected metadata, current ACL checks on
  reads and retries, and read-only AI access to the authorized exact version.
  Business type/source/claim semantics and response linkage remain owner decisions.
- Confinement: an adapter-controlled namespace, no client path/key authority,
  traversal/symlink/alias/escape defenses appropriate to the chosen backend, and
  credentials/permissions that prevent overwrite or unauthorized reads/deletes.
  No vendor, key format or storage layout is selected here.
- Atomic persistence: define durable acknowledgement, all-or-nothing object
  visibility, integrity validation on retrieval, and binding/publication only
  after durable identity is known. Resolve DB/storage failure ordering explicitly;
  a database transaction alone cannot roll back external storage.
- Orphan reconciliation: define recovery for durable bytes without committed DB
  binding and bindings whose bytes are missing/corrupt, retry/crash windows,
  ownership of reconciliation and safe race handling. Cleanup/retention policy
  requires owner approval; no automatic deletion or time window is invented.

Required acceptance before any production adapter claim: real-backend concurrent
create-if-absent, overwrite denial with runtime credentials, old-version reads
after replacement/restart, exact persisted bytes/hash/length (including equal-size
tampering), cross-organization/case binding and ACL denials, confinement attacks,
partial-write and crash fault injection around each DB/storage boundary, retry
and orphan reconciliation races, and read-only worker credential checks. Exercise
failures after durable storage but before DB commit and after binding commit but
before acknowledgement. Freeze expected outcomes before implementing the adapter.
An in-memory mock or the tests below cannot establish production immutability.

## Focused verification

From repository root:

```powershell
pnpm api:build
node --test apps/api/test/document-storage-integrity.cjs
```

Tests load compiled TypeScript from `dist/document-storage/byte-integrity.js` and
use synthetic bytes only. They perform no storage, database or service operations.
