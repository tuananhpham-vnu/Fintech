import { Injectable, Logger } from '@nestjs/common'
import { loadAiTransportConfig } from '../config/configuration'

export interface InspectionOutput {
  schema_version: string
  sha256: string
  page_count: number
  byte_size: number
  encrypted: boolean
  has_embedded_files: boolean
  mode?: string
}

export interface ExtractionOutput {
  schema_version: string
  document_id: string
  case_id: string
  sha256: string
  detected_type: string
  classification_confident: boolean
  pages: any[]
  fields: any[]
  evidence: any[]
  diagnostics: any[]
  provenance: any
  mode?: string
}

export class AiServiceException extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details: any = null,
  ) {
    super(message)
    this.name = 'AiServiceException'
  }
}

@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name)
  private readonly baseUrl: string
  private readonly internalApiKey: string

  constructor() {
    const config = loadAiTransportConfig()
    this.baseUrl = config.aiServiceUrl
    this.internalApiKey = config.internalApiKey
  }

  async inspect(
    storageKey: string,
    sha256: string,
    timeoutMs: number = 30000,
  ): Promise<InspectionOutput> {
    const url = `${this.baseUrl}/internal/v1/inspect`
    const payload = {
      schema_version: '1.0.2',
      storage_key: storageKey,
      sha256: sha256,
    }

    this.logger.log(`Calling FastAPI inspect: ${url} (storage_key: ${storageKey})`)

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Key': this.internalApiKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err: any) {
      if (err.name === 'TimeoutError' || err.code === 23) {
        this.logger.error(`AI service timeout after ${timeoutMs}ms at ${url}`)
        throw new AiServiceException(
          504,
          'AI_TIMEOUT',
          `FastAPI AI Service timed out after ${timeoutMs}ms`,
        )
      }
      this.logger.error(`Failed to reach AI service at ${url}: ${err.message}`)
      throw new AiServiceException(
        503,
        'AI_SERVICE_UNAVAILABLE',
        `Could not connect to FastAPI AI Service: ${err.message}`,
      )
    }

    const body: any = await response.json().catch(() => null)
    if (!response.ok) {
      const code = body?.code || 'INSPECTION_FAILED'
      const message = body?.message || `Inspection failed with status ${response.status}`
      throw new AiServiceException(response.status, code, message, body?.details)
    }

    // Validate expected fields
    if (
      !body ||
      typeof body.page_count !== 'number' ||
      typeof body.sha256 !== 'string' ||
      typeof body.encrypted !== 'boolean'
    ) {
      throw new AiServiceException(
        502,
        'INVALID_AI_RESPONSE',
        'AI service returned invalid inspection schema',
        body,
      )
    }

    const mode = response.headers.get('x-ai-mode') || undefined
    return { ...body, mode } as InspectionOutput
  }

  async extract(
    documentId: string,
    caseId: string,
    type: string,
    storageKey: string,
    sha256: string,
    timeoutMs: number = 30000,
  ): Promise<ExtractionOutput> {
    const url = `${this.baseUrl}/internal/v1/extract`
    const payload = {
      schema_version: '1.0.2',
      document_id: documentId,
      case_id: caseId,
      type: type,
      storage_key: storageKey,
      sha256: sha256,
    }

    this.logger.log(`Calling FastAPI extract: ${url} (doc: ${documentId}, type: ${type})`)

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Key': this.internalApiKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err: any) {
      if (err.name === 'TimeoutError' || err.code === 23) {
        this.logger.error(`AI service timeout after ${timeoutMs}ms at ${url}`)
        throw new AiServiceException(
          504,
          'AI_TIMEOUT',
          `FastAPI AI Service timed out after ${timeoutMs}ms`,
        )
      }
      this.logger.error(`Failed to reach AI service at ${url}: ${err.message}`)
      throw new AiServiceException(
        503,
        'AI_SERVICE_UNAVAILABLE',
        `Could not connect to FastAPI AI Service: ${err.message}`,
      )
    }

    const body: any = await response.json().catch(() => null)
    if (!response.ok) {
      const code = body?.code || 'EXTRACTION_FAILED'
      const message = body?.message || `Extraction failed with status ${response.status}`
      throw new AiServiceException(response.status, code, message, body?.details)
    }

    if (!body || !Array.isArray(body.fields)) {
      throw new AiServiceException(
        502,
        'INVALID_AI_RESPONSE',
        'AI service returned invalid extraction schema',
        body,
      )
    }

    const mode = response.headers.get('x-ai-mode') || undefined
    return { ...body, mode } as ExtractionOutput
  }
}
