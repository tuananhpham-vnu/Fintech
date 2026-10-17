import { Injectable, BadRequestException, PayloadTooLargeException } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { loadConfig } from '../config/configuration'

@Injectable()
export class StorageService {
  private readonly storageRoot: string
  private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MiB limit

  constructor() {
    this.storageRoot = path.resolve(loadConfig().storageDir)
    const stagingDir = path.join(this.storageRoot, 'staging')
    if (!fs.existsSync(stagingDir)) {
      fs.mkdirSync(stagingDir, { recursive: true })
    }
  }

  getStorageRoot(): string {
    return this.storageRoot
  }

  validateDocId(docId: string): void {
    if (!docId || typeof docId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(docId)) {
      throw new BadRequestException({
        code: 'INVALID_DOCUMENT_ID',
        message: 'Document ID contains invalid characters or path traversal elements',
      })
    }
  }

  saveFile(
    docId: string,
    buffer: Buffer,
  ): { storageKey: string; sha256: string; filePath: string } {
    this.validateDocId(docId)

    if (buffer.length > StorageService.MAX_FILE_SIZE) {
      throw new PayloadTooLargeException({
        code: 'PAYLOAD_TOO_LARGE',
        message: `File size (${buffer.length} bytes) exceeds maximum limit of 10MB`,
      })
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
    const relativeKey = `staging/${docId}.pdf`
    const absolutePath = path.resolve(this.storageRoot, relativeKey)

    // Security Confinement: Ensure target stays inside storageRoot
    if (!absolutePath.startsWith(this.storageRoot)) {
      throw new BadRequestException({
        code: 'PATH_TRAVERSAL_DETECTED',
        message: 'File destination escapes storage boundary',
      })
    }

    fs.writeFileSync(absolutePath, buffer)
    return { storageKey: relativeKey, sha256, filePath: absolutePath }
  }

  getFile(docId: string): Buffer | null {
    this.validateDocId(docId)
    const relativeKey = `staging/${docId}.pdf`
    const absolutePath = path.resolve(this.storageRoot, relativeKey)

    if (!absolutePath.startsWith(this.storageRoot)) {
      throw new BadRequestException({
        code: 'PATH_TRAVERSAL_DETECTED',
        message: 'File destination escapes storage boundary',
      })
    }

    if (fs.existsSync(absolutePath)) {
      return fs.readFileSync(absolutePath)
    }
    return null
  }
}
