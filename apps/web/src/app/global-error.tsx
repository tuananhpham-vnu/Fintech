'use client'
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main style={{ padding: 48, fontFamily: 'sans-serif' }}>
          <h1>AIC Rating</h1>
          <p>Unable to display this page. Please try again.</p>
          <button onClick={reset}>Try again</button>
        </main>
      </body>
    </html>
  )
}
