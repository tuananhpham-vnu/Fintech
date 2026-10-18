'use client'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Brand } from '@/components/layout/brand'
import { LocaleSelect } from '@/components/layout/locale-select'
import { useMutation } from '@/hooks/use-mutation'
import { ApiError } from '@/lib/api/client'
import { useSession } from '@/lib/auth/session-context'
import { useLocale } from '@/lib/i18n/locale-provider'
import { safeReturnTo } from '@/lib/utils/navigation'
import { ArrowRight, Eye, EyeOff, FileSearch, Handshake, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
export function Login({ reauth = false }: { reauth?: boolean }) {
  const { locale, t } = useLocale(),
    { status, error: sessionError, login } = useSession(),
    router = useRouter(),
    action = useMutation()
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [visible, setVisible] = useState(false)
  useEffect(() => {
    if (status === 'ready' && !reauth)
      router.replace(safeReturnTo(new URLSearchParams(window.location.search).get('returnTo')))
  }, [status, reauth, router])
  return (
    <main className="login-page aic-production" lang={locale}>
      <section className="login-story">
        <Brand />
        <div className="login-story-copy">
          <span className="tag">{t('desk')}</span>
          <h1>
            <span className="hero-primary">{t('heroLead')}</span>{' '}
            <span className="hero-accent">{t('heroAccent')}</span>
          </h1>
          <p>{t('heroText')}</p>
          <div className="login-benefits">
            {(
              [
                { Icon: FileSearch, title: 'evidenceTitle', help: 'evidenceHelp' },
                { Icon: Handshake, title: 'transactionTitle', help: 'transactionHelp' },
                { Icon: ShieldCheck, title: 'humanTitle', help: 'humanHelp' },
              ] as const
            ).map(({ Icon, title, help }) => (
              <div key={title} className="login-benefit">
                <span>
                  <Icon size={21} />
                </span>
                <div>
                  <strong>{t(title)}</strong>
                  <p>{t(help)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="login-story-footer">
          <span>AIC RATING</span>
          <span>COUNTERPARTY INTELLIGENCE</span>
        </div>
      </section>
      <section className="login-form-side">
        <div className="login-locale">
          <LocaleSelect />
        </div>
        <div className="login-card">
          <div className="login-icon">
            <ShieldCheck size={28} />
          </div>
          <p className="eyebrow">{t('specialist')}</p>
          <h2>{t('welcome')}</h2>
          <p>{t('loginHelp')}</p>
          {reauth && (
            <p className="warning-banner" role="status">
              {t('expired')}
            </p>
          )}
          <ErrorNotice
            error={
              action.error instanceof ApiError && action.error.status === 401
                ? null
                : (action.error ?? sessionError)
            }
          />
          {action.error instanceof ApiError && action.error.status === 401 && (
            <p className="form-error" role="alert">
              {t('invalidLogin')}
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void action.run(
                () => login(username.trim(), password),
                () => setPassword(''),
              )
            }}
          >
            <label className="field-label">
              {t('username')}
              <input
                name="username"
                autoComplete="username"
                required
                maxLength={254}
                value={username}
                disabled={action.busy}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label className="field-label">
              {t('password')}
              <span className="password-wrap">
                <input
                  name="password"
                  type={visible ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  maxLength={512}
                  disabled={action.busy}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t(visible ? 'hide' : 'show')}
                  onClick={() => setVisible((v) => !v)}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
            <button
              type="submit"
              className="primary-button login-enter"
              disabled={action.busy || status === 'loading'}
            >
              {t(action.busy ? 'working' : 'login')}
              <ArrowRight size={17} />
            </button>
          </form>
        </div>
      </section>
    </main>
  )
}
