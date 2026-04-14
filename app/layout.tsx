import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Flag Review — Edgar Cleaning',
  description: 'Review flagged jobs before they enter the dispatch queue',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif", background: '#F9FAFB' }}>
        {children}
      </body>
    </html>
  )
}
