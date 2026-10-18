'use client'
import { Loading } from '@/components/feedback/loading'
import { useLocale } from '@/lib/i18n/locale-provider'
import type { PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist'
import { useEffect, useRef, useState } from 'react'
export function PdfView({
  url,
  initialPage,
  onPageChange,
}: {
  url: string
  initialPage: number
  onPageChange: (page: number) => void
}) {
  const { t } = useLocale(),
    canvas = useRef<HTMLCanvasElement>(null),
    [page, setPage] = useState(initialPage),
    [count, setCount] = useState(0),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(false),
    [zoom, setZoom] = useState(100)
  useEffect(() => {
    onPageChange(page)
  }, [page, onPageChange])
  useEffect(() => {
    let cancelled = false,
      task: PDFDocumentLoadingTask | undefined,
      render: RenderTask | undefined
    setBusy(true)
    setError(false)
    void (async () => {
      try {
        const pdf = await import('pdfjs-dist')
        if (cancelled) return
        pdf.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs'
        task = pdf.getDocument({
          url,
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdfjs/standard_fonts/',
          wasmUrl: '/pdfjs/wasm/',
          enableXfa: false,
        })
        const doc = await task.promise
        if (cancelled) return
        setCount(doc.numPages)
        if (page < 1 || page > doc.numPages) throw new Error('Invalid evidence page')
        const selected = await doc.getPage(page),
          viewport = selected.getViewport({ scale: 1.5 })
        if (cancelled || !canvas.current) return
        canvas.current.width = Math.ceil(viewport.width)
        canvas.current.height = Math.ceil(viewport.height)
        render = selected.render({ canvas: canvas.current, viewport })
        await render.promise
        if (!cancelled) setBusy(false)
      } catch {
        if (!cancelled) {
          setError(true)
          setBusy(false)
        }
      }
    })()
    return () => {
      cancelled = true
      render?.cancel()
      void task?.destroy().catch(() => {})
    }
  }, [url, page])
  return (
    <>
      <div className="aic-pdf-controls">
        <button
          className="secondary-button"
          disabled={page <= 1 || busy}
          onClick={() => setPage((n) => n - 1)}
        >
          {t('previous')}
        </button>
        <span>
          {page}/{count || '—'}
        </span>
        <button
          className="secondary-button"
          disabled={page >= count || busy}
          onClick={() => setPage((n) => n + 1)}
        >
          {t('next')}
        </button>
        <select
          aria-label={t('zoom')}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
        >
          {[75, 100, 125, 150, 200].map((n) => (
            <option key={n} value={n}>
              {n}%
            </option>
          ))}
        </select>
      </div>
      {busy && <Loading />}
      {error && (
        <p role="alert" className="form-error">
          {t('sourceUnavailable')}
        </p>
      )}
      <div className="pdf-canvas-wrap">
        <canvas
          hidden={busy || error}
          ref={canvas}
          role="img"
          aria-label={`${t('source')} · ${t('page')} ${page}`}
          style={{ width: `${zoom}%`, maxWidth: 'none' }}
        />
      </div>
    </>
  )
}
