'use client'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Loading } from '@/components/feedback/loading'
import { Brand } from '@/components/layout/brand'
import { LocaleSelect } from '@/components/layout/locale-select'
import { useMutation } from '@/hooks/use-mutation'
import { useSession } from '@/lib/auth/session-context'
import { useLocale } from '@/lib/i18n/locale-provider'
import { BriefcaseBusiness, Building2, ChevronRight, LogOut, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode } from 'react'
export function Shell({
  children,
  title,
  reauthenticate,
}: {
  children: ReactNode
  title?: string
  reauthenticate: ReactNode
}) {
  const { t } = useLocale(),
    { session, status, error, refreshSession, logout } = useSession(),
    action = useMutation(),
    pathname = usePathname()
  if (status === 'loading' && !session) return <Loading />
  if (!session)
    return (
      <main className="session-wall">
        <Brand />
        {status === 'error' ? (
          <ErrorNotice error={error} retry={refreshSession} />
        ) : (
          <>
            <h1>{t('login')}</h1>
            <p>{t('loginHelp')}</p>
            <Link className="primary-button" href="/login">
              {t('login')}
              <ChevronRight size={17} />
            </Link>
          </>
        )}
      </main>
    )
  return (
    <>
      <div hidden={status === 'expired'} className="app-shell aic-production">
        <a className="aic-skip" href="#workspace-main">
          {t('overview')}
        </a>
        <aside className="sidebar">
          <Brand />
          <div className="sidebar-workspace">
            <Building2 size={18} />
            <span>{session.user.display_name}</span>
          </div>
          <nav className="primary-nav" aria-label={t('desk')}>
            <p className="eyebrow">{t('desk')}</p>
            <Link
              href="/cases"
              className={pathname.startsWith('/cases') ? 'nav-item active' : 'nav-item'}
            >
              <BriefcaseBusiness size={19} />
              {t('cases')}
            </Link>
            <Link
              href="/counterparties"
              className={pathname.startsWith('/counterparties') ? 'nav-item active' : 'nav-item'}
            >
              <Building2 size={19} />
              {t('counterparties')}
            </Link>
          </nav>
          <div className="sidebar-footer">
            <ShieldCheck size={22} />
            <div>
              <strong>{session.user.display_name}</strong>
              <span>{t('specialist')}</span>
            </div>
          </div>
        </aside>
        <div className="content-area">
          <header className="topbar">
            <div className="breadcrumb">
              <Link href="/cases">{t('cases')}</Link>
              {title && (
                <>
                  <ChevronRight size={13} />
                  <strong>{title}</strong>
                </>
              )}
            </div>
            <div className="top-actions">
              <LocaleSelect />
              <button
                className="text-button"
                disabled={action.busy}
                onClick={() => {
                  if (document.querySelector('dialog[open]')) return
                  void action.run(() => logout())
                }}
              >
                <LogOut size={16} />
                {t('logout')}
              </button>
            </div>
          </header>
          <nav className="aic-mobile-nav">
            <Link href="/cases">{t('cases')}</Link>
            <Link href="/counterparties">{t('counterparties')}</Link>
          </nav>
          <main id="workspace-main" className="page-content">
            <ErrorNotice error={action.error} />
            {children}
            <footer className="page-footer">AIC Rating · {t('noAutoApproval')}</footer>
          </main>
        </div>
      </div>
      {status === 'expired' && reauthenticate}
    </>
  )
}
