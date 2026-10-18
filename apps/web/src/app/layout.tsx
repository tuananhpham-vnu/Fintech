import { AppProvider } from '@/app/providers'
import type { Metadata, Viewport } from 'next'
import { Newsreader, Be_Vietnam_Pro } from 'next/font/google'
import '@/styles/index.css'

const newsreader = Newsreader({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-newsreader',
  display: 'swap',
})

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-be-vietnam-pro',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'AIC Rating · Đánh giá rủi ro đối tác',
  description:
    'Đánh giá rủi ro đối tác và giao dịch trả trước, bán chịu dựa trên hồ sơ và bằng chứng.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
  icons: {
    icon: [
      {
        url: '/icon.svg?v=aic2',
        type: 'image/svg+xml',
      },
      {
        url: '/icon-light-32x32.png?v=aic2',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png?v=aic2',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/favicon.ico?v=aic2',
      },
    ],
    apple: '/apple-icon.png?v=aic2',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#102f28',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${newsreader.variable} ${beVietnamPro.variable}`}>
      <body className="antialiased">
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  )
}
