const id = '[a-zA-Z0-9_-]+'
const routes: [string, RegExp][] = [
  ['GET', /^auth\/me$/],
  ['POST', /^auth\/(login|logout)$/],
  ['GET|POST', /^counterparties$/],
  ['GET|PATCH', new RegExp(`^counterparties/${id}$`)],
  ['GET|POST', /^cases$/],
  ['GET', new RegExp(`^cases/${id}$`)],
  ['PATCH', new RegExp(`^cases/${id}/exposure$`)],
  [
    'POST',
    new RegExp(
      `^cases/${id}/(documents|document-archives|review-runs|requests|waivers|assessments|questionnaires)$`,
    ),
  ],
  ['GET', new RegExp(`^cases/${id}/(readiness|history)$`)],
  ['GET|POST', new RegExp(`^cases/${id}/dossier-archives$`)],
  ['GET', new RegExp(`^dossier-archives/${id}$`)],
  ['GET', new RegExp(`^dossier-members/${id}/(source|extraction-summary)$`)],
  ['GET|POST', new RegExp(`^cases/${id}/financial-sets$`)],
  ['PATCH', new RegExp(`^financial-sets/${id}$`)],
  ['POST', new RegExp(`^financial-sets/${id}/verification$`)],
  ['GET', new RegExp(`^documents/${id}/(source|extraction|extraction-summary)$`)],
  ['POST', new RegExp(`^documents/${id}/(classification|corrections|verification)$`)],
  ['GET', new RegExp(`^(jobs|review-runs|evidence|assessments|questionnaires)/${id}$`)],
  ['POST', new RegExp(`^jobs/${id}/retry$`)],
  ['PATCH', new RegExp(`^requests/${id}$`)],
  ['POST', new RegExp(`^requests/${id}/(approve|cancel|ack)$`)],
  ['GET', new RegExp(`^requests/${id}/export$`)],
  ['POST', new RegExp(`^issues/${id}/decisions$`)],
  ['POST', new RegExp(`^waivers/${id}/revoke$`)],
  ['POST', new RegExp(`^assessments/${id}/acknowledge$`)],
  ['POST', new RegExp(`^questionnaires/${id}/(staff-responses|invitations|close)$`)],
  ['POST', new RegExp(`^responses/${id}/verification$`)],
  ['POST', new RegExp(`^invitations/${id}/revoke$`)],
  ['GET', /^respondent\/form$/],
  ['POST', /^respondent\/responses$/],
]
export function isPublicApiRoute(method: string, path: string) {
  return routes.some(([verbs, pattern]) => verbs.split('|').includes(method) && pattern.test(path))
}
export function backendBase(value: string) {
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.replace(/\/$/, '').endsWith('/api/v2')
  )
    throw new Error('Invalid AIC_BACKEND_URL')
  return url.href.replace(/\/$/, '')
}
