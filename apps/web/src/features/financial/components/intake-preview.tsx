'use client'
import { useCallback, useEffect, useState } from 'react'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Loading } from '@/components/feedback/loading'
import { PdfView } from '@/features/evidence/components/pdf-view'
import { useSession } from '@/lib/auth/session-context'
import { intakeApi, type IntakeItem } from '../intake-api'

export function IntakePreview({
  item,
  initialPage = 1,
}: {
  item: IntakeItem
  initialPage?: number
}) {
  const { status, session } = useSession(),
    [url, setUrl] = useState(''),
    [error, setError] = useState<unknown>(),
    [page, setPage] = useState(initialPage)
  const sessionKey = session ? `${session.user.id}:${session.csrf_token}` : ''
  const onPageChange = useCallback((n: number) => setPage(n), [])
  useEffect(() => {
    setUrl('')
    setError(undefined)
    setPage(initialPage)
    if (!item.prepared_source_id || status !== 'ready') return
    const controller = new AbortController()
    let objectUrl = ''
    void intakeApi
      .pdf(item.prepared_source_id, controller.signal)
      .then(async (blob) => {
        if (blob.size > 25_000_000) throw Error('Source too large')
        const bytes = await blob.arrayBuffer()
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
        if (
          hash !== item.classification?.sha256 ||
          new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-'
        )
          throw Error('Source integrity failure')
        if (!controller.signal.aborted) {
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
          setUrl(objectUrl)
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e)
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [
    item.id,
    item.prepared_source_id,
    item.classification?.sha256,
    status,
    sessionKey,
    initialPage,
  ])
  const location = item.origin.locations?.find((l) => l.page === page)
  return (
    <div className="financial-source-preview">
      <div className="wrap-actions">
        <strong>{item.name}</strong>
        <a className="text-button" href={intakeApi.originalUrl(item.id)}>
          Tải bản gốc
        </a>
      </div>
      {location?.sheet && (
        <p className="muted">
          Sheet: {location.sheet} · Ô: {location.cells?.join(', ')}
        </p>
      )}
      {!item.prepared_source_id ? (
        <p>Bản gốc đã lưu. Bản xem trước sẽ có sau khi xử lý.</p>
      ) : (
        <>
          <ErrorNotice error={error} />
          {!url && !error && <Loading />}
          {url && (
            <PdfView
              continuous
              key={`${url}:${initialPage}`}
              url={url}
              initialPage={initialPage}
              onPageChange={onPageChange}
            />
          )}
        </>
      )}
    </div>
  )
}
