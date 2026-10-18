'use client'
import type { Document } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
export function DocumentLineage({
  document: d,
  documents = [],
}: {
  document: Document
  documents?: Document[]
}) {
  const { locale, t } = useLocale()
  const old = ['superseded', 'retired'].includes(d.status)
  const sources = [...new Set(documents.map((d) => d.lineage))].sort()
  const position = sources.indexOf(d.lineage) + 1
  return (
    <div>
      {!!position && (
        <strong>
          {locale === 'vi' ? 'Chuỗi nguồn' : locale === 'en' ? 'Source family' : '来源组'}{' '}
          {position} ·{' '}
        </strong>
      )}
      <span className={`tag ${old ? 'amber' : 'neutral'}`}>
        {locale === 'vi'
          ? old
            ? 'Bản cũ — không dùng cho nguồn hiện hành'
            : 'Bản đang được hồ sơ tham chiếu'
          : locale === 'en'
            ? old
              ? 'Historical version — not a current source'
              : 'Version referenced by this case'
            : old
              ? '旧版本 — 非当前来源'
              : '本档案引用版本'}{' '}
        · v{d.version}
      </span>
      <details className="source-reference">
        <summary>
          {locale === 'vi'
            ? 'Đối chiếu chuỗi và phiên bản nguồn'
            : locale === 'en'
              ? 'Source family and version reference'
              : '来源组与版本参考'}
        </summary>
        <p>
          {t('version')}: {d.version} · {d.lineage}
        </p>
        <code>{d.hash}</code>
      </details>
    </div>
  )
}
