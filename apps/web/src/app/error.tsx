'use client'
import { ErrorNotice } from '@/components/feedback/error-notice'
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="session-wall">
      <h1>AIC Rating</h1>
      <ErrorNotice error={new Error('Render failed')} retry={reset} />
    </main>
  )
}
