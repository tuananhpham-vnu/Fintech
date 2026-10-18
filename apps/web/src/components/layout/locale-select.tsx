'use client'
import { useLocale } from '@/lib/i18n/locale-provider'
import { Globe2 } from 'lucide-react'
export function LocaleSelect() {
  const { locale, setLocale, t } = useLocale()
  return (
    <label className="locale-select">
      <Globe2 size={16} />
      <span className="sr-only">{t('language')}</span>
      <select value={locale} onChange={(e) => setLocale(e.target.value as typeof locale)}>
        <option value="en">English</option>
        <option value="vi">Tiếng Việt</option>
        <option value="zh-CN">简体中文</option>
      </select>
    </label>
  )
}
