import { Workspace } from '@/features/cases/components/workspace'
export default async function Page({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params
  return <Workspace key={caseId} caseId={caseId} />
}
