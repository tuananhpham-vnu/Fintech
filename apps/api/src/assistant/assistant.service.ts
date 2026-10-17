import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { DocumentDecisions } from '../documents/document-decisions.service'
import { LEGACY_FIELD_KEY_PREFIX } from '../documents/evidence-projection'
import { DOCUMENT_REPOSITORY } from '../documents/ports'
import type { DocumentRepository, StoredDocument } from '../documents/ports'
import { FoundationError } from '../foundation/errors'
import { FOUNDATION_CONFIG, FOUNDATION_DB } from '../foundation/ports'
import type { AuthSession, FoundationDatabase } from '../foundation/ports'
import { validateContract } from '../foundation/validation'
import type { AppConfig } from '../config/configuration'

/**
 * Case assistant (aic-chat-0.1): Q&A/analysis and keyword search over ONE case the caller can read.
 * The backend selects the data (ACL, current versions, reviewer corrections); the AI service only answers
 * and must cite pages of the documents sent. Nothing is persisted except a content-free audit event.
 */
const MAX_DOCUMENTS = 60
const AI_TIMEOUT_MS = 80_000
const MAX_AI_RESPONSE_BYTES = 2_000_000
const RATE_WINDOW_MS = 5 * 60_000
const RATE_MAX_QUESTIONS = 20
const MAX_HITS = 50

type ChatDocument = {
  document_id: string
  name: string
  type: string
  version: number
  pages: { page: number; text: string; method: 'text' | 'ocr' }[]
  fields: { field_key: string; value: string | null; quality: string }[]
}

export function fold(text: string) {
  return text
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

/** Folded text plus, for every folded char, the index of the source char it came from. */
function foldWithMap(text: string) {
  let folded = ''
  const map: number[] = []
  let index = 0
  for (const char of text) {
    const f = fold(char)
    for (let i = 0; i < f.length; i++) map.push(index)
    folded += f
    index += char.length
  }
  map.push(index)
  return { folded, map }
}

@Injectable()
export class AssistantService {
  private readonly asked = new Map<string, number[]>()
  constructor(
    @Inject(FOUNDATION_DB) private readonly db: FoundationDatabase,
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepository,
    @Inject(DocumentDecisions) private readonly decisions: DocumentDecisions,
    @Inject(FOUNDATION_CONFIG) private readonly config: AppConfig,
  ) {}

  /** ACL + session are enforced by repository.list (same path as the Files tab). */
  private async caseDocuments(session: AuthSession, caseId: string) {
    const listed = await this.documents.list(session, caseId)
    const usable = listed.filter((d) => d.extraction && d.status === 'completed')
    const projections = await this.decisions.projections(session, caseId, usable)
    const docs: { stored: StoredDocument; chat: ChatDocument }[] = []
    usable.forEach((stored, index) => {
      const projected = projections[index]
      const raw = stored.extraction as any
      if (!projected || !Array.isArray(raw?.pages)) return
      docs.push({
        stored,
        chat: {
          document_id: stored.id,
          name: String(stored.name).slice(0, 300),
          type: String(stored.type).slice(0, 64),
          version: Number(stored.version),
          pages: raw.pages.slice(0, 10).map((p: any) => ({
            page: Number(p.page),
            text: String(p.text ?? '').slice(0, 40_000),
            method: p.method === 'ocr' ? 'ocr' : 'text',
          })),
          fields: projected.fields.slice(0, 40).map((f) => ({
            field_key: f.field_key.startsWith(LEGACY_FIELD_KEY_PREFIX)
              ? f.field_key.slice(LEGACY_FIELD_KEY_PREFIX.length)
              : f.field_key,
            value:
              f.value === null || f.value === undefined
                ? null
                : (typeof f.value === 'string' ? f.value : JSON.stringify(f.value)).slice(0, 2000),
            quality: String(f.quality).slice(0, 32),
          })),
        },
      })
    })
    return docs.slice(0, MAX_DOCUMENTS)
  }

  private async findings(session: AuthSession, caseId: string) {
    const run = (
      await this.db.query(
        `SELECT payload_json FROM aic.mvp_review_runs WHERE organization_id=$1 AND case_id=$2
        ORDER BY case_revision DESC, created_at DESC LIMIT 1`,
        [session.user.organization_id, caseId],
      )
    ).rows[0]
    const findings = Array.isArray(run?.payload_json?.findings) ? run.payload_json.findings : []
    return findings.slice(0, 100).map((f: any) => ({
      rule_id: String(f.rule_id ?? '').slice(0, 32),
      severity: String(f.severity ?? '').slice(0, 32),
      summary: String(f.summary ?? '').slice(0, 1000),
      state: String(f.finding_state ?? '').slice(0, 32),
    }))
  }

  private rateLimit(userId: string) {
    const now = Date.now()
    const recent = (this.asked.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
    if (recent.length >= RATE_MAX_QUESTIONS)
      throw new FoundationError(429, 'RATE_LIMITED', 'Too many assistant questions; retry later.')
    recent.push(now)
    this.asked.set(userId, recent)
  }

  async ask(session: AuthSession, caseId: string, body: unknown) {
    validateContract('AssistantQuestionInput', body)
    const input = body as { question: string; history: { role: string; content: string }[] }
    const docs = await this.caseDocuments(session, caseId) // 404 before rate-limit for foreign cases
    this.rateLimit(session.user.id)
    const request = {
      schema_version: 'aic-chat-0.1',
      case_id: caseId,
      question: input.question,
      history: input.history,
      documents: docs.map((d) => d.chat),
      findings: await this.findings(session, caseId),
    }
    validateContract('CaseChatInput', request, true)
    const output = await this.callAi(request)
    const byId = new Map(docs.map((d) => [d.stored.id, d.stored]))
    const answer = {
      case_id: caseId,
      answer: output.answer,
      citations: output.citations.map((c: any) => {
        const stored = byId.get(c.document_id)!
        return {
          ...c,
          document_name: String(stored.name).slice(0, 300),
          document_version: Number(stored.version),
          source_hash: stored.hash,
        }
      }),
      metrics: output.metrics,
      diagnostics: output.diagnostics,
      documents_considered: docs.length,
      mode: output.provenance.mode,
    }
    await this.audit(session, caseId, {
      question_chars: input.question.length,
      documents: docs.length,
      citations: answer.citations.length,
      verified_citations: answer.citations.filter((c: any) => c.verified).length,
      mode: output.provenance.mode,
      model_id: output.provenance.model_id,
      prompt_version: output.provenance.prompt_version,
    })
    return answer
  }

  private async callAi(request: unknown): Promise<any> {
    let response: Response
    try {
      response = await fetch(`${this.config.aiServiceUrl}/internal/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Key': this.config.internalApiKey },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
        redirect: 'manual', // never forward the internal key to a redirect target
      })
    } catch (err: any) {
      throw new FoundationError(
        err?.name === 'TimeoutError' ? 504 : 503,
        err?.name === 'TimeoutError' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE',
      )
    }
    const text = await response.text()
    if (text.length > MAX_AI_RESPONSE_BYTES) throw new FoundationError(502, 'INVALID_AI_RESPONSE')
    let body: any = null
    try {
      body = JSON.parse(text)
    } catch {
      throw new FoundationError(502, 'INVALID_AI_RESPONSE')
    }
    if (response.status === 503) throw new FoundationError(503, 'AI_UNAVAILABLE')
    if (response.status !== 200) throw new FoundationError(502, 'AI_ANSWER_REJECTED')
    try {
      validateContract('CaseChatOutput', body, true)
    } catch {
      throw new FoundationError(502, 'INVALID_AI_RESPONSE')
    }
    const mode = response.headers.get('x-ai-mode')
    if (mode !== body.provenance.mode || (this.config.documentAiMode && mode !== this.config.documentAiMode))
      throw new FoundationError(502, 'AI_MODE_MISMATCH')
    return body
  }

  private async audit(session: AuthSession, caseId: string, metadata: Record<string, unknown>) {
    await this.db.query(
      `INSERT INTO aic.audit_events(id,organization_id,case_id,actor_type,actor_id,action,subject_id,metadata_json)
      VALUES($1,$2,$3,'specialist',$4,'assistant.question',$3,$5::jsonb)`,
      [randomUUID(), session.user.organization_id, caseId, session.user.id, JSON.stringify(metadata)],
    )
  }

  /** Deterministic accent-insensitive keyword search; no model call. */
  async search(session: AuthSession, caseId: string, query: Record<string, unknown>) {
    if (Object.keys(query).some((k) => k !== 'q') || typeof query.q !== 'string')
      throw new FoundationError(422, 'INVALID_INPUT')
    const q = query.q.trim()
    if (q.length < 2 || q.length > 200) throw new FoundationError(422, 'INVALID_INPUT')
    const needle = fold(q).replace(/\s+/g, ' ')
    const docs = await this.caseDocuments(session, caseId)
    const hits: any[] = []
    let truncated = false
    for (const { stored, chat } of docs)
      for (const page of chat.pages) {
        const { folded, map } = foldWithMap(page.text)
        const haystack = folded.replace(/\s/g, ' ')
        let at = haystack.indexOf(needle)
        while (at !== -1) {
          if (hits.length >= MAX_HITS) {
            truncated = true
            break
          }
          const start = map[at],
            end = map[at + needle.length]
          const from = Math.max(0, start - 120),
            to = Math.min(page.text.length, end + 120)
          const snippet = page.text.slice(from, to).replace(/\s+/g, ' ').slice(0, 400)
          const matchStart = Math.min(page.text.slice(from, start).replace(/\s+/g, ' ').length, snippet.length - 1)
          hits.push({
            document_id: stored.id,
            document_name: String(stored.name).slice(0, 300),
            document_type: String(stored.type).slice(0, 64),
            page: page.page,
            snippet,
            match_start: Math.max(0, matchStart),
            match_length: Math.max(
              1,
              Math.min(page.text.slice(start, end).replace(/\s+/g, ' ').length, snippet.length - matchStart),
            ),
          })
          at = haystack.indexOf(needle, at + needle.length)
        }
      }
    return { query: q, hits, truncated }
  }
}
