import { Shell } from '@/components/layout/app-shell'
import { Login } from '@/features/auth/components/login'
import type { ReactNode } from 'react'
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <Shell reauthenticate={<Login reauth />}>{children}</Shell>
}
