'use client'
import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Loading } from '@/components/feedback/loading'

function Page({
  document,
  page,
  visiblePage,
}: {
  document: PDFDocumentProxy
  page: number
  visiblePage: (n: number) => void
}) {
  const holder = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false),
    [error, setError] = useState(false)
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        setVisible(entry.isIntersecting)
        if (entry.isIntersecting) visiblePage(page)
      },
      { rootMargin: '500px' },
    )
    if (holder.current) observer.observe(holder.current)
    return () => observer.disconnect()
  }, [page, visiblePage])
  useEffect(() => {
    if (!visible) return
    let cancelled = false,
      rendering: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    void document
      .getPage(page)
      .then(async (source) => {
        if (cancelled || !canvas.current) return
        const viewport = source.getViewport({ scale: 1.5 })
        canvas.current.width = Math.ceil(viewport.width)
        canvas.current.height = Math.ceil(viewport.height)
        rendering = source.render({ canvas: canvas.current, viewport })
        await rendering.promise
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
      rendering?.cancel()
      if (canvas.current) {
        canvas.current.width = 0
        canvas.current.height = 0
      }
    }
  }, [document, page, visible])
  return (
    <div
      ref={holder}
      id={`source-page-${page}`}
      className="financial-pdf-page"
      style={{ minHeight: 600 }}
    >
      <small>Trang {page}</small>
      {error ? (
        <p role="alert">Không hiển thị được trang {page}. Có thể tải bản gốc để đối chiếu.</p>
      ) : (
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Tài liệu gốc · trang ${page}`}
          style={{ width: '100%', height: 'auto' }}
        />
      )}
    </div>
  )
}

export function ScrollPdfView({
  url,
  initialPage,
  onPageChange,
}: {
  url: string
  initialPage: number
  onPageChange: (page: number) => void
}) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null),
    [error, setError] = useState(false),
    [zoom, setZoom] = useState(100)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let cancelled = false,
      task: ReturnType<(typeof import('pdfjs-dist'))['getDocument']> | undefined
    setDocument(null)
    setError(false)
    void import('pdfjs-dist')
      .then(async (pdf) => {
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
        const loaded = await task.promise
        if (initialPage < 1 || initialPage > loaded.numPages) throw Error('Invalid source page')
        if (!cancelled) setDocument(loaded)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
      void task?.destroy().catch(() => {})
    }
  }, [url, initialPage])
  useEffect(() => {
    if (document && initialPage > 1)
      root.current?.querySelector(`#source-page-${initialPage}`)?.scrollIntoView({ block: 'start' })
  }, [document, initialPage])
  return (
    <div ref={root}>
      <label className="aic-pdf-controls">
        Thu phóng{' '}
        <select
          aria-label="Thu phóng tài liệu"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
        >
          {[75, 100, 125, 150, 200].map((n) => (
            <option key={n} value={n}>
              {n}%
            </option>
          ))}
        </select>{' '}
        · {document?.numPages ?? '…'} trang · Cuộn để đọc
      </label>
      {error && <p role="alert">Không mở được bản xem trước. Hãy tải bản gốc.</p>}
      {!document && !error && <Loading />}
      <div style={{ width: `${zoom}%`, maxWidth: 'none' }}>
        {document &&
          Array.from({ length: document.numPages }, (_, i) => (
            <Page key={i} document={document} page={i + 1} visiblePage={onPageChange} />
          ))}
      </div>
    </div>
  )
}
