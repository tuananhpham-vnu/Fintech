export type SourceTarget =
  | { evidenceId: string; name?: string }
  | { documentId: string; version: number; hash: string; name?: string }
  | { dossierMemberId: string; hash?: string | null; name?: string; page?: number }
