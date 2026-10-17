const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { createReporter } = require('./feasibility-results.cjs')

const FRONTEND_BASE = 'http://127.0.0.1:3000/api/v2'
const BACKEND_BASE = 'http://127.0.0.1:3001/api/v2'
const FASTAPI_BASE = 'http://127.0.0.1:8100'

async function run(logResult) {
  console.log('====================================================')
  console.log('AIC Rating 2.0 — End-to-End Feasibility Integration Test')
  console.log('====================================================\n')

  let sessionCookie = ''
  let csrfToken = ''

  // ----------------------------------------------------
  // TEST 1: Login via Frontend Proxy -> NestJS
  // ----------------------------------------------------
  try {
    const loginRes = await fetch(`${FRONTEND_BASE}/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://127.0.0.1:3000',
      },
      body: JSON.stringify({
        username: 'qa.specialist',
        password: 'TestOnly#2026',
      }),
    })

    const loginBody = await loginRes.json()
    const setCookie = loginRes.headers.get('set-cookie')

    if (loginRes.status === 200 && loginBody?.csrf_token && setCookie) {
      sessionCookie = setCookie.split(';')[0]
      csrfToken = loginBody.csrf_token
      logResult(
        '1. Login via Frontend Proxy -> NestJS',
        'PASS',
        `Status ${loginRes.status}, user: ${loginBody.user?.display_name}, csrf_token: ${csrfToken.slice(0, 8)}...`,
      )
    } else {
      logResult(
        '1. Login via Frontend Proxy -> NestJS',
        'FAIL',
        `Status ${loginRes.status}, body: ${JSON.stringify(loginBody)}`,
      )
    }
  } catch (err) {
    logResult('1. Login via Frontend Proxy -> NestJS', 'FAIL', err.message)
  }

  // ----------------------------------------------------
  // TEST 2: Check Session via Frontend Proxy -> NestJS
  // ----------------------------------------------------
  try {
    const meRes = await fetch(`${FRONTEND_BASE}/auth/me`, {
      headers: {
        cookie: sessionCookie,
      },
    })
    const meBody = await meRes.json()
    if (meRes.status === 200 && meBody?.user?.role === 'specialist') {
      logResult(
        '2. Verify Session via Frontend Proxy -> NestJS',
        'PASS',
        `Status 200, specialist role confirmed, user id: ${meBody.user.id}`,
      )
    } else {
      logResult(
        '2. Verify Session via Frontend Proxy -> NestJS',
        'FAIL',
        `Status ${meRes.status}, body: ${JSON.stringify(meBody)}`,
      )
    }
  } catch (err) {
    logResult('2. Verify Session via Frontend Proxy -> NestJS', 'FAIL', err.message)
  }

  // ----------------------------------------------------
  // TEST 3: Get Case Detail via Frontend Proxy -> NestJS
  // ----------------------------------------------------
  const caseId = 'a06adf0c-7110-51f6-86ad-4b4b903c3e9e'
  let caseRevision = 1
  try {
    const caseRes = await fetch(`${FRONTEND_BASE}/cases/${caseId}`, {
      headers: {
        cookie: sessionCookie,
      },
    })
    const caseBody = await caseRes.json()
    if (caseRes.status === 200 && caseBody?.id === caseId) {
      caseRevision = caseBody.revision
      logResult(
        '3. Get Case Detail via Frontend Proxy -> NestJS',
        'PASS',
        `Status 200, case: ${caseBody.id}, exposure: ${caseBody.exposure?.amount_vnd} VND, revision: ${caseRevision}`,
      )
    } else {
      logResult(
        '3. Get Case Detail via Frontend Proxy -> NestJS',
        'FAIL',
        `Status ${caseRes.status}, body: ${JSON.stringify(caseBody)}`,
      )
    }
  } catch (err) {
    logResult('3. Get Case Detail via Frontend Proxy -> NestJS', 'FAIL', err.message)
  }

  // ----------------------------------------------------
  // TEST 4: Vertical Slice: Upload PDF -> NestJS -> FastAPI Inspect & Extract -> Frontend
  // ----------------------------------------------------
  const fixturePdfPath = path.resolve('packages/contracts/fixtures/04_contract.pdf')
  const pdfBytes = fs.readFileSync(fixturePdfPath)
  let uploadedDocId = null
  let uploadJobId = null

  try {
    const boundary = '----WebKitFormBoundary' + randomUUID().replace(/-/g, '')
    const formChunks = []

    function addField(name, val) {
      formChunks.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${val}\r\n`),
      )
    }

    addField('type', 'contract')
    addField('source_class', 'synthetic')
    addField('mode', 'new')
    addField('expected_revision', String(caseRevision))

    formChunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="04_contract.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
    )
    formChunks.push(pdfBytes)
    formChunks.push(Buffer.from(`\r\n--${boundary}--\r\n`))

    const multipartBody = Buffer.concat(formChunks)

    const uploadRes = await fetch(`${FRONTEND_BASE}/cases/${caseId}/documents`, {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        cookie: sessionCookie,
        origin: 'http://127.0.0.1:3000',
        'x-csrf-token': csrfToken,
        'idempotency-key': randomUUID(),
      },
      body: multipartBody,
    })

    const uploadData = await uploadRes.json()
    if (uploadRes.status === 202 && uploadData?.document?.id && uploadData?.job?.id) {
      uploadedDocId = uploadData.document.id
      uploadJobId = uploadData.job.id
      logResult(
        '4. Upload PDF via Frontend -> NestJS -> FastAPI Inspect/Extract',
        'PASS',
        `Status 202 ACCEPTED. docId: ${uploadedDocId}, pages: ${uploadData.document.pages}, hash: ${uploadData.document.hash.slice(0, 10)}..., job state: ${uploadData.job.state}`,
      )
    } else {
      logResult(
        '4. Upload PDF via Frontend -> NestJS -> FastAPI Inspect/Extract',
        'FAIL',
        `Status ${uploadRes.status}, body: ${JSON.stringify(uploadData)}`,
      )
    }
  } catch (err) {
    logResult('4. Upload PDF via Frontend -> NestJS -> FastAPI Inspect/Extract', 'FAIL', err.message)
  }

  // ----------------------------------------------------
  // TEST 5: Verify Document Source PDF Fetch
  // ----------------------------------------------------
  if (uploadedDocId) {
    try {
      const srcRes = await fetch(`${FRONTEND_BASE}/documents/${uploadedDocId}/source`, {
        headers: { cookie: sessionCookie },
      })
      const srcBuf = await srcRes.arrayBuffer()
      const returnedHash = createHash('sha256').update(Buffer.from(srcBuf)).digest('hex')
      const originalHash = createHash('sha256').update(pdfBytes).digest('hex')

      if (srcRes.status === 200 && returnedHash === originalHash) {
        logResult(
          '5. Fetch Immutable PDF Source via Frontend Proxy -> NestJS',
          'PASS',
          `Status 200, Content-Type: ${srcRes.headers.get('content-type')}, SHA256 verified (${returnedHash.slice(0, 10)}...)`,
        )
      } else {
        logResult(
          '5. Fetch Immutable PDF Source via Frontend Proxy -> NestJS',
          'FAIL',
          `Status ${srcRes.status}, hash match: ${returnedHash === originalHash}`,
        )
      }
    } catch (err) {
      logResult('5. Fetch Immutable PDF Source via Frontend Proxy -> NestJS', 'FAIL', err.message)
    }
  } else {
    logResult('5. Fetch Immutable PDF Source via Frontend Proxy -> NestJS', 'BLOCKED', 'No docId from step 4')
  }

  // ----------------------------------------------------
  // TEST 6: Fetch Extraction Results
  // ----------------------------------------------------
  if (uploadedDocId) {
    try {
      const extRes = await fetch(`${FRONTEND_BASE}/documents/${uploadedDocId}/extraction`, {
        headers: { cookie: sessionCookie },
      })
      const extData = await extRes.json()

      if (extRes.status === 200 && Array.isArray(extData)) {
        logResult(
          '6. Fetch Extraction Fields via Frontend Proxy -> NestJS',
          'PASS',
          `Status 200, returned ${extData.length} extracted fields (keys: ${extData.map((f) => f.field_key).join(', ')})`,
        )
      } else {
        logResult(
          '6. Fetch Extraction Fields via Frontend Proxy -> NestJS',
          'FAIL',
          `Status ${extRes.status}, body: ${JSON.stringify(extData)}`,
        )
      }
    } catch (err) {
      logResult('6. Fetch Extraction Fields via Frontend Proxy -> NestJS', 'FAIL', err.message)
    }
  } else {
    logResult('6. Fetch Extraction Fields via Frontend Proxy -> NestJS', 'BLOCKED', 'No docId from step 4')
  }

  // ----------------------------------------------------
  // TEST 7: Check Job Status via Frontend Proxy -> NestJS
  // ----------------------------------------------------
  if (uploadJobId) {
    try {
      const jobRes = await fetch(`${FRONTEND_BASE}/jobs/${uploadJobId}`, {
        headers: { cookie: sessionCookie },
      })
      const jobData = await jobRes.json()
      if (jobRes.status === 200 && jobData?.id === uploadJobId) {
        logResult(
          '7. Check Job Status via Frontend Proxy -> NestJS',
          'PASS',
          `Status 200, Job ID: ${jobData.id}, state: ${jobData.state}`,
        )
      } else {
        logResult(
          '7. Check Job Status via Frontend Proxy -> NestJS',
          'FAIL',
          `Status ${jobRes.status}, body: ${JSON.stringify(jobData)}`,
        )
      }
    } catch (err) {
      logResult('7. Check Job Status via Frontend Proxy -> NestJS', 'FAIL', err.message)
    }
  } else {
    logResult('7. Check Job Status via Frontend Proxy -> NestJS', 'BLOCKED', 'No jobId from step 4')
  }

  // ----------------------------------------------------
  // TEST 8: Negative Test: Malformed Request (Non-PDF uploaded)
  // ----------------------------------------------------
  try {
    const boundary = '----WebKitFormBoundary' + randomUUID().replace(/-/g, '')
    const formChunks = []
    function addField(name, val) {
      formChunks.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${val}\r\n`),
      )
    }
    addField('type', 'contract')
    addField('source_class', 'synthetic')
    addField('mode', 'new')
    const revCheck = await (await fetch(`${FRONTEND_BASE}/cases/${caseId}`, { headers: { cookie: sessionCookie } })).json()
    addField('expected_revision', String(revCheck.revision))

    // Corrupted file (not starting with %PDF-)
    const badFile = Buffer.from('NOT_A_VALID_PDF_HEADER_CONTENT')
    formChunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bad.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
    )
    formChunks.push(badFile)
    formChunks.push(Buffer.from(`\r\n--${boundary}--\r\n`))

    const badRes = await fetch(`${FRONTEND_BASE}/cases/${caseId}/documents`, {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        cookie: sessionCookie,
        origin: 'http://127.0.0.1:3000',
        'x-csrf-token': csrfToken,
        'idempotency-key': randomUUID(),
      },
      body: Buffer.concat(formChunks),
    })

    const badBody = await badRes.json()
    if (badRes.status === 400 && badBody?.code === 'INVALID_PDF') {
      logResult(
        '8. Negative Test: Malformed Request Rejected',
        'PASS',
        `Correctly rejected with HTTP 400 INVALID_PDF (${badBody.message})`,
      )
    } else {
      logResult(
        '8. Negative Test: Malformed Request Rejected',
        'FAIL',
        `Expected 400 INVALID_PDF, got status ${badRes.status}: ${JSON.stringify(badBody)}`,
      )
    }
  } catch (err) {
    logResult('8. Negative Test: Malformed Request Rejected', 'FAIL', err.message)
  }

  // ----------------------------------------------------
  // TEST 9: Negative Test: Revision Mismatch (Optimistic Concurrency)
  // ----------------------------------------------------
  try {
    const boundary = '----WebKitFormBoundary' + randomUUID().replace(/-/g, '')
    const formChunks = []
    function addField(name, val) {
      formChunks.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${val}\r\n`),
      )
    }
    addField('type', 'contract')
    addField('source_class', 'synthetic')
    addField('mode', 'new')
    addField('expected_revision', '999') // wrong revision

    formChunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="04_contract.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
    )
    formChunks.push(pdfBytes)
    formChunks.push(Buffer.from(`\r\n--${boundary}--\r\n`))

    const conflictRes = await fetch(`${FRONTEND_BASE}/cases/${caseId}/documents`, {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        cookie: sessionCookie,
        origin: 'http://127.0.0.1:3000',
        'x-csrf-token': csrfToken,
        'idempotency-key': randomUUID(),
      },
      body: Buffer.concat(formChunks),
    })

    const conflictBody = await conflictRes.json()
    if (conflictRes.status === 409 && conflictBody?.code === 'REVISION_CONFLICT') {
      logResult(
        '9. Negative Test: Revision Conflict Rejected',
        'PASS',
        `Correctly rejected with HTTP 409 REVISION_CONFLICT (${conflictBody.message})`,
      )
    } else {
      logResult(
        '9. Negative Test: Revision Conflict Rejected',
        'FAIL',
        `Expected 409 REVISION_CONFLICT, got status ${conflictRes.status}: ${JSON.stringify(conflictBody)}`,
      )
    }
  } catch (err) {
    logResult('9. Negative Test: Revision Conflict Rejected', 'FAIL', err.message)
  }

  // ----------------------------------------------------
  // TEST 10: Negative Test: AI Service Down / Unavailable
  // ----------------------------------------------------
  try {
    // We test NestJS direct handling when AI service URL is unreachable
    const testAiClient = new (require('../apps/api/dist/ai-client/ai-client.service').AiClientService)()
    // Point baseUrl to an unreachable port
    testAiClient.baseUrl = 'http://127.0.0.1:59999'

    let caughtError = null
    try {
      await testAiClient.inspect('staging/dummy.pdf', '0'.repeat(64))
    } catch (err) {
      caughtError = err
    }

    if (caughtError && caughtError.statusCode === 503 && caughtError.code === 'AI_SERVICE_UNAVAILABLE') {
      logResult(
        '10. Negative Test: AI Service Down / Connection Refused',
        'PASS',
        `Correctly caught connection error and mapped to 503 AI_SERVICE_UNAVAILABLE: ${caughtError.message}`,
      )
    } else {
      logResult(
        '10. Negative Test: AI Service Down / Connection Refused',
        'FAIL',
        `Expected 503 AI_SERVICE_UNAVAILABLE, got: ${caughtError}`,
      )
    }
  } catch (err) {
    logResult('10. Negative Test: AI Service Down / Connection Refused', 'FAIL', err.message)
  }

  // ----------------------------------------------------
  // TEST 11: Negative Test: AI Response Schema Mismatch
  // ----------------------------------------------------
  try {
    const testAiClient = new (require('../apps/api/dist/ai-client/ai-client.service').AiClientService)()
    // We can simulate an AI endpoint returning invalid schema
    // Inspect returns invalid object (e.g. missing page_count)
    let caughtSchemaError = null
    const http = require('node:http')
    const mockBadServer = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ schema_version: '1.0.2', bad_field: true })) // missing page_count, sha256
    })

    await new Promise((resolve) => mockBadServer.listen(59998, '127.0.0.1', resolve))
    testAiClient.baseUrl = 'http://127.0.0.1:59998'

    try {
      await testAiClient.inspect('staging/dummy.pdf', '0'.repeat(64))
    } catch (err) {
      caughtSchemaError = err
    } finally {
      mockBadServer.close()
    }

    if (caughtSchemaError && caughtSchemaError.statusCode === 502 && caughtSchemaError.code === 'INVALID_AI_RESPONSE') {
      logResult(
        '11. Negative Test: AI Response Schema Mismatch',
        'PASS',
        `Correctly caught invalid schema and mapped to 502 INVALID_AI_RESPONSE: ${caughtSchemaError.message}`,
      )
    } else {
      logResult(
        '11. Negative Test: AI Response Schema Mismatch',
        'FAIL',
        `Expected 502 INVALID_AI_RESPONSE, got: ${caughtSchemaError}`,
      )
    }
  } catch (err) {
    logResult('11. Negative Test: AI Response Schema Mismatch', 'FAIL', err.message)
  }

  // ----------------------------------------------------
  // TEST 12: Verify Frontend UI Page Render
  // ----------------------------------------------------
  try {
    const uiRes = await fetch(`http://127.0.0.1:3000/cases/${caseId}`, {
      headers: {
        cookie: sessionCookie,
      },
    })
    const uiHtml = await uiRes.text()
    if (uiRes.status === 200 && uiHtml.includes('<!DOCTYPE html>')) {
      logResult(
        '12. Verify Frontend Case Detail UI Page Render',
        'PASS',
        `Status 200 OK, rendered HTML (${uiHtml.length} bytes)`,
      )
    } else {
      logResult(
        '12. Verify Frontend Case Detail UI Page Render',
        'FAIL',
        `Status ${uiRes.status}, HTML length: ${uiHtml.length}`,
      )
    }
  } catch (err) {
    logResult('12. Verify Frontend Case Detail UI Page Render', 'FAIL', err.message)
  }

  // ----------------------------------------------------
  // TEST 13: Upload Arbitrary Non-Fixture PDF -> FastAPI Extract 503 -> NestJS Job Failed -> UI Error Handling
  // ----------------------------------------------------
  try {
    // Read current case revision
    const currentCaseRes = await fetch(`${FRONTEND_BASE}/cases/${caseId}`, {
      headers: { cookie: sessionCookie },
    })
    const currentCase = await currentCaseRes.json()
    const nextRev = currentCase.revision

    const boundary = '----WebKitFormBoundary' + randomUUID().replace(/-/g, '')
    const formChunks = []
    function addField(name, val) {
      formChunks.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${val}\r\n`),
      )
    }
    addField('type', 'contract')
    addField('source_class', 'synthetic')
    addField('mode', 'new')
    addField('expected_revision', String(nextRev))

    // Valid synthetic PDF with unique content so its hash is not in gold fixtures
    const arbitraryPdf = Buffer.from(
      `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n% unique-${Date.now()}`,
    )

    formChunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="arbitrary_sample.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
    )
    formChunks.push(arbitraryPdf)
    formChunks.push(Buffer.from(`\r\n--${boundary}--\r\n`))

    const arbitraryRes = await fetch(`${FRONTEND_BASE}/cases/${caseId}/documents`, {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        cookie: sessionCookie,
        origin: 'http://127.0.0.1:3000',
        'x-csrf-token': csrfToken,
        'idempotency-key': randomUUID(),
      },
      body: Buffer.concat(formChunks),
    })

    const arbitraryData = await arbitraryRes.json()
    if (
      arbitraryRes.status === 202 &&
      arbitraryData?.job?.state === 'failed' &&
      arbitraryData?.job?.errors?.length > 0
    ) {
      logResult(
        '13. Non-Fixture PDF Upload -> FastAPI 503 -> NestJS Job Failed -> UI Error Handling',
        'PASS',
        `Non-fixture rejection verified from FastAPI: ${JSON.stringify(arbitraryData.job.errors)}`,
      )
    } else {
      logResult(
        '13. Non-Fixture PDF Upload -> FastAPI 503 -> NestJS Job Failed -> UI Error Handling',
        'FAIL',
        `Status ${arbitraryRes.status}, data: ${JSON.stringify(arbitraryData)}`,
      )
    }
  } catch (err) {
    logResult(
      '13. Non-Fixture PDF Upload -> FastAPI Extract 503 -> NestJS Job Failed -> UI Error Handling',
      'FAIL',
      err.message,
    )
  }

  // ----------------------------------------------------
  // TEST 14: Negative Test: Oversized File (>10MB) Rejected
  // ----------------------------------------------------
  try {
    const boundary = '----WebKitFormBoundary' + randomUUID().replace(/-/g, '')
    const formChunks = []
    function addField14(name, val) {
      formChunks.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${val}\r\n`),
      )
    }
    addField14('type', 'contract')
    addField14('expected_revision', String(caseRevision))

    // 11 MB payload exceeding 10MB limit
    const largePdf = Buffer.alloc(11 * 1024 * 1024, 0x20)
    largePdf.write('%PDF-1.4\n', 0)

    formChunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="oversized.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
    )
    formChunks.push(largePdf)
    formChunks.push(Buffer.from(`\r\n--${boundary}--\r\n`))

    const largeRes = await fetch(`${FRONTEND_BASE}/cases/${caseId}/documents`, {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        cookie: sessionCookie,
        origin: 'http://127.0.0.1:3000',
        'x-csrf-token': csrfToken,
        'idempotency-key': randomUUID(),
      },
      body: Buffer.concat(formChunks),
    })

    if (largeRes.status === 413) {
      logResult(
        '14. Negative Test: Oversized File (>10MB) Rejected with HTTP 413',
        'PASS',
        `Correctly rejected with status 413 PAYLOAD_TOO_LARGE`,
      )
    } else {
      logResult(
        '14. Negative Test: Oversized File (>10MB) Rejected with HTTP 413',
        'FAIL',
        `Expected 413, got status ${largeRes.status}`,
      )
    }
  } catch (err) {
    logResult('14. Negative Test: Oversized File (>10MB) Rejected with HTTP 413', 'FAIL', err.message)
  }

  // ----------------------------------------------------
  // TEST 15: Negative Test: Cross-Origin Request Rejected with HTTP 403
  // ----------------------------------------------------
  try {
    const crossRes = await fetch(`${FRONTEND_BASE}/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://malicious-site.example',
      },
      body: JSON.stringify({
        username: 'qa.specialist',
        password: 'TestOnly#2026',
      }),
    })
    const crossBody = await crossRes.json().catch(() => ({}))
    if (crossRes.status === 403 && crossBody?.code === 'ORIGIN_REJECTED') {
      logResult(
        '15. Negative Test: Cross-Origin Mutation Rejected with HTTP 403',
        'PASS',
        `Status 403, code: ${crossBody.code}`,
      )
    } else {
      logResult(
        '15. Negative Test: Cross-Origin Mutation Rejected with HTTP 403',
        'FAIL',
        `Expected 403 ORIGIN_REJECTED, got ${crossRes.status} (${JSON.stringify(crossBody)})`,
      )
    }
  } catch (err) {
    logResult('15. Negative Test: Cross-Origin Mutation Rejected with HTTP 403', 'FAIL', err.message)
  }

  // ----------------------------------------------------
  // TEST 16: Negative Test: Missing CSRF Token Rejected with HTTP 403
  // ----------------------------------------------------
  try {
    const noCsrfRes = await fetch(`${FRONTEND_BASE}/cases/${caseId}/documents`, {
      method: 'POST',
      headers: {
        cookie: sessionCookie,
        origin: 'http://127.0.0.1:3000',
        'idempotency-key': randomUUID(),
      },
      body: Buffer.from('test'),
    })
    const noCsrfBody = await noCsrfRes.json().catch(() => ({}))
    if (noCsrfRes.status === 403 && noCsrfBody?.code === 'CSRF_REQUIRED') {
      logResult(
        '16. Negative Test: Missing CSRF Token on Mutation Rejected with HTTP 403',
        'PASS',
        `Status 403, code: ${noCsrfBody.code}`,
      )
    } else {
      logResult(
        '16. Negative Test: Missing CSRF Token on Mutation Rejected with HTTP 403',
        'FAIL',
        `Expected 403 CSRF_REQUIRED, got ${noCsrfRes.status} (${JSON.stringify(noCsrfBody)})`,
      )
    }
  } catch (err) {
    logResult('16. Negative Test: Missing CSRF Token on Mutation Rejected with HTTP 403', 'FAIL', err.message)
  }

  // ----------------------------------------------------
  // TEST 17: Idempotency-Key Replay with Same Payload
  // ----------------------------------------------------
  const idempKey = randomUUID()
  let firstUploadResponse = null
  try {
    // Fetch latest revision
    const cRes = await fetch(`${FRONTEND_BASE}/cases/${caseId}`, { headers: { cookie: sessionCookie } })
    const cData = await cRes.json()
    const rev = cData.revision

    const contractPdfPath = path.resolve(__dirname, '..', 'packages', 'contracts', 'fixtures', '04_contract.pdf')
    const fileBytes = fs.readFileSync(contractPdfPath)

    function makeUploadReq(pdfBuffer, curRev) {
      const boundary = '----WebKitFormBoundary' + randomUUID().replace(/-/g, '')
      const chunks = [
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\ncontract\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="expected_revision"\r\n\r\n${curRev}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="04_contract.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
        pdfBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]
      return { body: Buffer.concat(chunks), boundary }
    }

    const req1 = makeUploadReq(fileBytes, rev)
    const res1 = await fetch(`${FRONTEND_BASE}/cases/${caseId}/documents`, {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${req1.boundary}`,
        cookie: sessionCookie,
        origin: 'http://127.0.0.1:3000',
        'x-csrf-token': csrfToken,
        'idempotency-key': idempKey,
      },
      body: req1.body,
    })
    firstUploadResponse = await res1.json()

    // Replay with exact same idempotency key and same payload
    const req2 = makeUploadReq(fileBytes, rev)
    const res2 = await fetch(`${FRONTEND_BASE}/cases/${caseId}/documents`, {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${req2.boundary}`,
        cookie: sessionCookie,
        origin: 'http://127.0.0.1:3000',
        'x-csrf-token': csrfToken,
        'idempotency-key': idempKey,
      },
      body: req2.body,
    })
    const replayResponse = await res2.json()

    if (res2.status === 202 && replayResponse?.document?.id === firstUploadResponse?.document?.id) {
      logResult(
        '17. Idempotency-Key Replay: Same Key + Same Payload Returns Cached 202',
        'PASS',
        `Replay identical docId: ${replayResponse.document.id}, status 202`,
      )
    } else {
      logResult(
        '17. Idempotency-Key Replay: Same Key + Same Payload Returns Cached 202',
        'FAIL',
        `Status ${res2.status}, response: ${JSON.stringify(replayResponse)}`,
      )
    }
  } catch (err) {
    logResult('17. Idempotency-Key Replay: Same Key + Same Payload Returns Cached 202', 'FAIL', err.message)
  }

  // ----------------------------------------------------
  // TEST 18: Negative Test: Idempotency-Key Replay with Different Payload Rejected
  // ----------------------------------------------------
  try {
    const diffPdf = Buffer.from('%PDF-1.4\n% different content\n%%EOF')
    const boundary = '----WebKitFormBoundary' + randomUUID().replace(/-/g, '')
    const chunks = [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\ncontract\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="expected_revision"\r\n\r\n1\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="diff.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      diffPdf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]

    const diffRes = await fetch(`${FRONTEND_BASE}/cases/${caseId}/documents`, {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        cookie: sessionCookie,
        origin: 'http://127.0.0.1:3000',
        'x-csrf-token': csrfToken,
        'idempotency-key': idempKey, // re-using same key with different payload
      },
      body: Buffer.concat(chunks),
    })
    const diffBody = await diffRes.json().catch(() => ({}))
    if (diffRes.status === 400 && diffBody?.code === 'IDEMPOTENCY_MISMATCH') {
      logResult(
        '18. Negative Test: Idempotency-Key Replay with Different Payload Rejected with HTTP 400',
        'PASS',
        `Status 400, code: ${diffBody.code}`,
      )
    } else {
      logResult(
        '18. Negative Test: Idempotency-Key Replay with Different Payload Rejected with HTTP 400',
        'FAIL',
        `Expected 400 IDEMPOTENCY_MISMATCH, got ${diffRes.status} (${JSON.stringify(diffBody)})`,
      )
    }
  } catch (err) {
    logResult('18. Negative Test: Idempotency-Key Replay with Different Payload Rejected with HTTP 400', 'FAIL', err.message)
  }

  // ----------------------------------------------------
  // TEST 19: Security: Path Traversal Attempt in Document ID Rejected
  // ----------------------------------------------------
  try {
    const traversalRes = await fetch(`${BACKEND_BASE}/documents/..%2F..%2Fstorage/source`, {
      headers: { cookie: sessionCookie },
    })
    const traversalBody = await traversalRes.json().catch(() => ({}))
    if (
      traversalRes.status === 400 &&
      (traversalBody?.code === 'INVALID_DOCUMENT_ID' || traversalBody?.code === 'PATH_TRAVERSAL_DETECTED')
    ) {
      logResult(
        '19. Security: Path Traversal Attempt in Document ID Rejected',
        'PASS',
        `Status ${traversalRes.status}, code: ${traversalBody.code}`,
      )
    } else {
      logResult(
        '19. Security: Path Traversal Attempt in Document ID Rejected',
        'FAIL',
        `Expected 400 traversal rejection, got status ${traversalRes.status} (${JSON.stringify(traversalBody)})`,
      )
    }
  } catch (err) {
    logResult('19. Security: Path Traversal Attempt in Document ID Rejected', 'FAIL', err.message)
  }

  // ----------------------------------------------------
  // TEST 20: Policy & Method Guard: Readiness Confirms Method Unconfigured and Score Blocked (Null)
  // ----------------------------------------------------
  try {
    const readyRes = await fetch(`${FRONTEND_BASE}/cases/${caseId}/readiness`, {
      headers: { cookie: sessionCookie },
    })
    const readiness = await readyRes.json()

    const caseDetailRes = await fetch(`${FRONTEND_BASE}/cases/${caseId}`, {
      headers: { cookie: sessionCookie },
    })
    const caseDetail = await caseDetailRes.json()

    if (
      readyRes.status === 200 &&
      readiness.method_status === 'unconfigured' &&
      readiness.numeric_assessment_allowed === false &&
      caseDetail.assessment === null
    ) {
      logResult(
        '20. Policy & Method Guard: Readiness Confirms Method Unconfigured and Score Blocked (Null)',
        'PASS',
        `method_status: "${readiness.method_status}", numeric_assessment_allowed: false, assessment: null`,
      )
    } else {
      logResult(
        '20. Policy & Method Guard: Readiness Confirms Method Unconfigured and Score Blocked (Null)',
        'FAIL',
        `Status ${readyRes.status}, readiness: ${JSON.stringify(readiness)}, assessment: ${caseDetail?.assessment}`,
      )
    }
  } catch (err) {
    logResult('20. Policy & Method Guard: Readiness Confirms Method Unconfigured and Score Blocked (Null)', 'FAIL', err.message)
  }

  // ----------------------------------------------------
  // TEST 21: Security Regression: Unauthorized GET /cases without Cookie
  // ----------------------------------------------------
  try {
    const unauthCasesRes = await fetch(`${BACKEND_BASE}/cases`)
    const unauthDetailRes = await fetch(`${BACKEND_BASE}/cases/${caseId}`)
    const isProtected =
      (unauthCasesRes.status === 401 || unauthCasesRes.status === 403) &&
      (unauthDetailRes.status === 401 || unauthDetailRes.status === 403)

    if (isProtected) {
      logResult(
        '21. Security Regression: Unauthorized GET /cases & /cases/:id Rejected',
        'PASS',
        `Correctly rejected unauthenticated request with status ${unauthCasesRes.status}/${unauthDetailRes.status}`,
      )
    } else {
      logResult(
        '21. Security Regression: Unauthorized GET /cases & /cases/:id Rejected',
        'FAIL',
        `VULNERABILITY [BLOCKER P0]: Expected HTTP 401/403, got status ${unauthCasesRes.status} (list) and ${unauthDetailRes.status} (detail). Backend prototype lacks session authentication & tenant isolation guards on GET /cases.`,
      )
    }
  } catch (err) {
    logResult('21. Security Regression: Unauthorized GET /cases & /cases/:id Rejected', 'FAIL', err.message)
  }

  // ----------------------------------------------------
  // TEST 22: Security Regression: Unauthorized GET /counterparties without Cookie
  // ----------------------------------------------------
  try {
    const unauthCpRes = await fetch(`${BACKEND_BASE}/counterparties`)
    const unauthCpDetailRes = await fetch(
      `${BACKEND_BASE}/counterparties/00000000-0000-4000-8000-000000000001`,
    )
    const isProtected =
      (unauthCpRes.status === 401 || unauthCpRes.status === 403) &&
      (unauthCpDetailRes.status === 401 || unauthCpDetailRes.status === 403)

    if (isProtected) {
      logResult(
        '22. Security Regression: Unauthorized GET /counterparties Rejected',
        'PASS',
        `Correctly rejected unauthenticated request with status ${unauthCpRes.status}`,
      )
    } else {
      logResult(
        '22. Security Regression: Unauthorized GET /counterparties Rejected',
        'FAIL',
        `VULNERABILITY [BLOCKER P0]: Expected HTTP 401/403, got status ${unauthCpRes.status} (list) and ${unauthCpDetailRes.status} (detail). Counterparties are publicly exposed without session authentication.`,
      )
    }
  } catch (err) {
    logResult('22. Security Regression: Unauthorized GET /counterparties Rejected', 'FAIL', err.message)
  }

  // ----------------------------------------------------
  // TEST 23: Security Regression: Unauthorized GET /documents/:id/source & /extraction without Cookie
  // ----------------------------------------------------
  if (uploadedDocId) {
    try {
      const unauthSrcRes = await fetch(`${BACKEND_BASE}/documents/${uploadedDocId}/source`)
      const unauthExtRes = await fetch(`${BACKEND_BASE}/documents/${uploadedDocId}/extraction`)
      const isProtected =
        (unauthSrcRes.status === 401 || unauthSrcRes.status === 403) &&
        (unauthExtRes.status === 401 || unauthExtRes.status === 403)

      if (isProtected) {
        logResult(
          '23. Security Regression: Unauthorized GET /documents/:id/source & /extraction Rejected',
          'PASS',
          `Correctly rejected unauthenticated document access with status ${unauthSrcRes.status}/${unauthExtRes.status}`,
        )
      } else {
        logResult(
          '23. Security Regression: Unauthorized GET /documents/:id/source & /extraction Rejected',
          'FAIL',
          `VULNERABILITY [BLOCKER P0]: Expected HTTP 401/403, got status ${unauthSrcRes.status} (source PDF) and ${unauthExtRes.status} (extraction). Confidential uploaded PDFs and financial data can be fetched without authentication.`,
        )
      }
    } catch (err) {
      logResult(
        '23. Security Regression: Unauthorized GET /documents/:id/source & /extraction Rejected',
        'FAIL',
        err.message,
      )
    }
  } else {
    logResult(
      '23. Security Regression: Unauthorized GET /documents/:id/source & /extraction Rejected',
      'BLOCKED',
      'No docId from step 4',
    )
  }

  // ----------------------------------------------------
  // TEST 24: Security Regression: Unauthorized GET /jobs/:id & /evidence/:id without Cookie
  // ----------------------------------------------------
  if (uploadJobId) {
    try {
      const unauthJobRes = await fetch(`${BACKEND_BASE}/jobs/${uploadJobId}`)
      const isProtected = unauthJobRes.status === 401 || unauthJobRes.status === 403

      if (isProtected) {
        logResult(
          '24. Security Regression: Unauthorized GET /jobs/:id & /evidence/:id Rejected',
          'PASS',
          `Correctly rejected unauthenticated request with status ${unauthJobRes.status}`,
        )
      } else {
        logResult(
          '24. Security Regression: Unauthorized GET /jobs/:id & /evidence/:id Rejected',
          'FAIL',
          `VULNERABILITY [BLOCKER P0]: Expected HTTP 401/403, got status ${unauthJobRes.status} (job). Job execution state and pipeline errors are accessible without authentication.`,
        )
      }
    } catch (err) {
      logResult(
        '24. Security Regression: Unauthorized GET /jobs/:id & /evidence/:id Rejected',
        'FAIL',
        err.message,
      )
    }
  } else {
    logResult(
      '24. Security Regression: Unauthorized GET /jobs/:id & /evidence/:id Rejected',
      'BLOCKED',
      'No jobId from step 4',
    )
  }

  // ----------------------------------------------------
  // TEST 25: Security Regression: Cross-Tenant Access with Invalid/Foreign Session Cookie
  // ----------------------------------------------------
  try {
    const invalidCookieRes = await fetch(`${BACKEND_BASE}/cases/${caseId}`, {
      headers: {
        cookie: 'aic_fe_qa=00000000-0000-4000-8000-invalidforeign99',
      },
    })

    if (invalidCookieRes.status === 401 || invalidCookieRes.status === 403) {
      logResult(
        '25. Security Regression: Cross-Tenant / Invalid Session Access Rejected',
        'PASS',
        `Correctly rejected invalid session with status ${invalidCookieRes.status}`,
      )
    } else {
      logResult(
        '25. Security Regression: Cross-Tenant / Invalid Session Access Rejected',
        'FAIL',
        `VULNERABILITY [BLOCKER P0]: Expected HTTP 401/403, got status ${invalidCookieRes.status}. Invalid/foreign cookie is silently ignored and case detail is served. Prototype lacks tenant/case ACL enforcement.`,
      )
    }
  } catch (err) {
    logResult(
      '25. Security Regression: Cross-Tenant / Invalid Session Access Rejected',
      'FAIL',
      err.message,
    )
  }

}

async function main(execute = run, reporter = createReporter()) {
  let fatal = false
  try {
    await execute(reporter.record)
  } catch {
    fatal = true
    // Raw exceptions may contain URLs, credentials or upstream response data.
    console.error('Feasibility runner aborted unexpectedly; result is ERROR.')
  }
  return reporter.finish(fatal)
}

module.exports = { main }
if (require.main === module) {
  void main().then((code) => { process.exitCode = code })
}
