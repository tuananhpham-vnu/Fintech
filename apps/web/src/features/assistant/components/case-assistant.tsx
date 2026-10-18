'use client'
import { ErrorNotice } from '@/components/feedback/error-notice'
import type { SourceTarget } from '@/features/evidence/types'
import type { CaseDetail, Locale } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { CheckCircle2, Search, Send, ShieldAlert } from 'lucide-react'
import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  assistantApi,
  type AssistantAnswer,
  type AssistantCitation,
  type AssistantMetric,
  type ChatTurn,
  type SearchResult,
} from '../api'

type Message = { role: 'user'; content: string } | { role: 'assistant'; answer: AssistantAnswer }

const MAX_HISTORY = 8

function words(locale: Locale) {
  return (en: string, vi: string, zh: string) => (locale === 'en' ? en : locale === 'vi' ? vi : zh)
}

function groupDigits(value: string, locale: Locale) {
  const negative = value.startsWith('-'),
    [whole, frac] = value.replace('-', '').split('.')
  const sep = locale === 'en' ? ',' : '.',
    dec = locale === 'en' ? '.' : ','
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep)
  return (negative ? '-' : '') + grouped + (frac ? dec + frac : '')
}

export function formatMetric(m: AssistantMetric, locale: Locale) {
  if (m.value === null) return '—'
  if (m.unit === 'ratio') {
    const percent = (Number(m.value) * 100).toFixed(1).replace(/\.0$/, '')
    return `${groupDigits(m.value, locale)} (${groupDigits(percent, locale)}%)`
  }
  return m.unit === 'count' ? m.value : `${groupDigits(m.value, locale)} ${m.unit}`
}

/** Answer text with [n] markers turned into buttons that open the cited source. */
function AnswerText({
  text,
  citations,
  open,
}: {
  text: string
  citations: AssistantCitation[]
  open: (c: AssistantCitation) => void
}) {
  const parts = text.split(/(\[\d{1,2}\])/g)
  return (
    <div className="assistant-answer">
      {parts.map((part, i) => {
        const marker = /^\[(\d{1,2})\]$/.exec(part)
        const citation = marker && citations.find((c) => c.id === Number(marker[1]))
        if (!marker) return <Fragment key={i}>{part}</Fragment>
        return citation ? (
          <button
            key={i}
            type="button"
            className={'assistant-marker' + (citation.verified ? '' : ' unverified')}
            title={citation.quote}
            onClick={() => open(citation)}
          >
            {citation.id}
          </button>
        ) : (
          <sup key={i} className="assistant-marker missing">
            ?
          </sup>
        )
      })}
    </div>
  )
}

function AnswerCard({
  answer,
  locale,
  open,
}: {
  answer: AssistantAnswer
  locale: Locale
  open: (c: AssistantCitation) => void
}) {
  const w = words(locale)
  const warnings = answer.diagnostics.filter((d) => d.code !== 'MOCK_ANSWER')
  return (
    <div className="assistant-bubble assistant">
      {answer.mode === 'mock' && (
        <p className="assistant-mode">
          {w(
            'MOCK · sample answer, not a model',
            'MOCK · câu trả lời mẫu, không phải model',
            'MOCK · 示例回答',
          )}
        </p>
      )}
      <AnswerText text={answer.answer} citations={answer.citations} open={open} />
      {answer.citations.length > 0 && (
        <ol className="assistant-citations">
          {answer.citations.map((c) => (
            <li key={c.id}>
              <button type="button" className="assistant-citation" onClick={() => open(c)}>
                <span className="assistant-citation-id">{c.id}</span>
                <span>
                  <strong>{c.document_name}</strong> · {w('page', 'trang', '第')} {c.page}
                  <q>{c.quote}</q>
                </span>
                {c.verified ? (
                  <CheckCircle2
                    size={14}
                    aria-label={w('verified quote', 'trích dẫn khớp nguồn', '已核对')}
                  />
                ) : (
                  <ShieldAlert
                    size={14}
                    className="assistant-warn"
                    aria-label={w('unverified quote', 'chưa khớp nguồn', '未核对')}
                  />
                )}
              </button>
            </li>
          ))}
        </ol>
      )}
      {answer.metrics.length > 0 && (
        <details className="assistant-metrics" open={answer.metrics.length <= 6}>
          <summary>
            {w('Computed metrics', 'Chỉ số tính bằng code', '代码计算指标')} (
            {answer.metrics.length})
          </summary>
          <table>
            <tbody>
              {answer.metrics.map((m, i) => (
                <tr key={m.metric_id + i}>
                  <th scope="row">
                    {m.label}
                    {m.period ? <small> · {m.period}</small> : null}
                  </th>
                  <td title={m.formula}>{formatMetric(m, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {warnings.length > 0 && (
        <ul className="assistant-diagnostics">
          {warnings.map((d, i) => (
            <li key={d.code + i}>
              <ShieldAlert size={13} /> {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Highlight({ hit }: { hit: SearchResult['hits'][number] }) {
  const { snippet, match_start: s, match_length: n } = hit
  return (
    <>
      {snippet.slice(0, s)}
      <mark>{snippet.slice(s, s + n)}</mark>
      {snippet.slice(s + n)}
    </>
  )
}

export function CaseAssistant({
  detail,
  openSource,
}: {
  detail: CaseDetail
  openSource: (target: SourceTarget) => void
}) {
  const { locale } = useLocale(),
    w = words(locale)
  const [messages, setMessages] = useState<Message[]>([]),
    [draft, setDraft] = useState(''),
    [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>(null)
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<SearchResult | null>(null),
    [searching, setSearching] = useState(false),
    [searchError, setSearchError] = useState<unknown>(null)
  const end = useRef<HTMLDivElement>(null),
    inflight = useRef<AbortController | null>(null)
  useEffect(() => () => inflight.current?.abort(), [])
  useEffect(() => end.current?.scrollIntoView?.({ block: 'nearest' }), [messages, pending])

  const suggestions = [
    w('Summarise this case file', 'Tóm tắt hồ sơ này', '总结本案材料'),
    w('Analyse the financial position', 'Phân tích tình hình tài chính', '分析财务状况'),
    w(
      'Are there inconsistencies between documents?',
      'Có mâu thuẫn nào giữa các tài liệu không?',
      '文件之间是否存在矛盾？',
    ),
    w('What information is missing?', 'Hồ sơ còn thiếu thông tin gì?', '还缺少哪些信息？'),
  ]

  const open = (c: AssistantCitation) =>
    openSource({
      documentId: c.document_id,
      version: c.document_version,
      hash: c.source_hash,
      name: c.document_name,
    })

  async function ask(question: string) {
    const trimmed = question.trim()
    if (!trimmed || pending) return
    const history: ChatTurn[] = messages
      .map((m): ChatTurn =>
        m.role === 'user'
          ? { role: 'user', content: m.content.slice(0, 4000) }
          : { role: 'assistant', content: m.answer.answer.slice(0, 4000) },
      )
      .slice(-MAX_HISTORY)
    setMessages((current) => [...current, { role: 'user', content: trimmed }])
    setDraft('')
    setError(null)
    setPending(true)
    const controller = new AbortController()
    inflight.current = controller
    try {
      const answer = await assistantApi.ask(
        detail.id,
        trimmed.slice(0, 2000),
        history,
        controller.signal,
      )
      setMessages((current) => [...current, { role: 'assistant', answer }])
    } catch (e) {
      if (!controller.signal.aborted) setError(e)
    } finally {
      setPending(false)
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault()
    void ask(draft)
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void ask(draft)
    }
  }
  async function search(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (q.length < 2) return
    setSearching(true)
    setSearchError(null)
    try {
      setResults(await assistantApi.search(detail.id, q))
    } catch (err) {
      setSearchError(err)
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="assistant-layout">
      <section
        className="panel aic-section assistant-chat"
        aria-label={w('Case assistant', 'Trợ lý hồ sơ', '案件助手')}
      >
        <h3>{w('Case assistant', 'Trợ lý hồ sơ', '案件助手')}</h3>
        <p className="assistant-scope">
          {w(
            'Answers use only the extracted documents of this case and cite their pages. Figures are computed in code. The assistant does not make credit decisions.',
            'Chỉ trả lời từ các tài liệu đã trích xuất của hồ sơ này, kèm trích dẫn trang. Số liệu phân tích được tính bằng code. Trợ lý không ra quyết định cấp tín dụng.',
            '仅依据本案已提取的文件作答并标注页码；指标由代码计算；助手不作授信决定。',
          )}
        </p>
        <div className="assistant-thread" aria-live="polite">
          {messages.length === 0 && (
            <div className="assistant-suggestions">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="secondary-button"
                  onClick={() => void ask(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="assistant-bubble user">
                {m.content}
              </div>
            ) : (
              <AnswerCard key={i} answer={m.answer} locale={locale} open={open} />
            ),
          )}
          {pending && (
            <div className="assistant-bubble assistant assistant-pending">
              {w('Reading the case documents…', 'Đang đọc hồ sơ…', '正在阅读材料…')}
            </div>
          )}
          <div ref={end} />
        </div>
        <ErrorNotice error={error} />
        <form className="assistant-input" onSubmit={submit}>
          <textarea
            value={draft}
            maxLength={2000}
            rows={2}
            placeholder={w(
              'Ask about this case… (Enter to send, Shift+Enter for a new line)',
              'Hỏi về hồ sơ này… (Enter để gửi, Shift+Enter xuống dòng)',
              '询问本案…（回车发送）',
            )}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            disabled={pending}
          />
          <button className="primary-button" type="submit" disabled={pending || !draft.trim()}>
            <Send size={16} /> {w('Send', 'Gửi', '发送')}
          </button>
        </form>
      </section>
      <section className="panel aic-section assistant-search">
        <h3>{w('Search documents', 'Tìm trong tài liệu', '搜索文件')}</h3>
        <form className="assistant-search-form" onSubmit={search}>
          <input
            type="search"
            value={query}
            maxLength={200}
            placeholder={w(
              'Tax ID, contract no., keyword…',
              'MST, số hợp đồng, từ khóa…',
              '税号、合同号、关键词…',
            )}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="secondary-button"
            type="submit"
            disabled={searching || query.trim().length < 2}
          >
            <Search size={16} />
          </button>
        </form>
        <ErrorNotice error={searchError} />
        {results && (
          <>
            <p className="assistant-scope">
              {results.hits.length} {w('matches', 'kết quả', '条结果')}
              {results.truncated ? ' +' : ''}
            </p>
            <ul className="assistant-hits">
              {results.hits.map((h, i) => (
                <li key={h.document_id + h.page + ':' + i}>
                  <strong>{h.document_name}</strong> · {w('page', 'trang', '第')} {h.page}
                  <p>
                    <Highlight hit={h} />
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
