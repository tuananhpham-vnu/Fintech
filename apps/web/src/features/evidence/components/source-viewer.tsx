'use client'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Loading } from '@/components/feedback/loading'
import { Modal } from '@/components/ui/modal'
import { evidenceApi } from '@/features/evidence/api'
import { PdfView } from '@/features/evidence/components/pdf-view'
import { SourceTarget } from '@/features/evidence/types'
import { useResource } from '@/hooks/use-resource'
import { ApiError } from '@/lib/api/client'
import type { Evidence } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { Download } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
export function SourceViewer({ target, onClose }: { target: SourceTarget; onClose: () => void }) {
  const { t } = useLocale(),
    load = useCallback(
      (signal: AbortSignal) =>
        'evidenceId' in target
          ? evidenceApi.evidence(target.evidenceId, signal)
          : Promise.resolve(null),
      [target],
    )
  const evidence = useResource(load),
    [url, setUrl] = useState(''),
    [error, setError] = useState<unknown>(null),
    [generation, setGeneration] = useState(0)
  const isDossierMember = 'dossierMemberId' in target
  const source =
    'evidenceId' in target
      ? evidence.data
      : isDossierMember
        ? ({
            document_id: target.dossierMemberId,
            document_version: 1,
            source_hash: target.hash ?? '',
            page: target.page ?? 1,
            quote: '',
          } as Evidence)
        : ({
            document_id: target.documentId,
            document_version: target.version,
            source_hash: target.hash,
            page: 1,
            quote: '',
          } as Evidence)
  useEffect(() => {
    if (!source) return
    const controller = new AbortController()
    let objectUrl = ''
    setUrl('')
    setError(null)
    const fetchBlob = isDossierMember
      ? evidenceApi.dossierMemberSource(target.dossierMemberId, controller.signal)
      : evidenceApi.source(source.document_id, controller.signal)

    void fetchBlob
      .then(async (blob) => {
        if (blob.size > 10 * 1024 * 1024) throw new Error('Source too large')
        const bytes = await blob.arrayBuffer()
        if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('Not a PDF')
        if (source.source_hash) {
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('')
          if (hash !== source.source_hash.toLowerCase().replace(/^sha256:/, ''))
            throw new ApiError(409, 'STALE_SOURCE', 'Source hash mismatch')
        }
        if (!controller.signal.aborted) {
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
          setUrl(objectUrl)
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err)
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [source?.document_id, source?.source_hash, isDossierMember, generation])
  return (
    <Modal title={target.name ?? t('evidence')} onClose={onClose} drawer>
      <ErrorNotice error={evidence.error} retry={evidence.reload} />
      {evidence.loading && <Loading />}
      {source && (
        <>
          <p className="mono">
            {target.name ? `${target.name} · ` : ''}
            {source.document_id}
            {!isDossierMember && ` · ${t('version')} ${source.document_version}`} · {t('page')}{' '}
            {source.page}
          </p>
          {source.quote && <blockquote>{source.quote}</blockquote>}
          {source.source_hash && <small className="aic-hash">SHA-256: {source.source_hash}</small>}
          <ErrorNotice error={error} retry={() => setGeneration((n) => n + 1)} />
          {!url && !error && <Loading />}
          {url && (
            <>
              <a href={url} target="_blank" rel="noreferrer" className="secondary-button">
                <Download size={15} />
                {t('source')}
              </a>
              <PdfView key={`${url}:${source.page}`} url={url} initialPage={source.page} />
            </>
          )}
        </>
      )}
    </Modal>
  )
}
