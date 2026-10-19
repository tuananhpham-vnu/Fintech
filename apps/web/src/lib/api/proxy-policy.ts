const id = '[a-zA-Z0-9_-]+'
const routes: [string, RegExp][] = [
  ['GET', /^auth\/me$/],
  ['POST', /^auth\/(login|logout)$/],
  ['GET|POST', /^counterparties$/],
  ['GET|PATCH', new RegExp(`^counterparties/${id}$`)],
  ['GET', /^cases$/],
  ['POST', /^company-assessments$/],
  ['GET', /^company-assessments\/capabilities$/],
  ['GET', new RegExp(`^cases/${id}$`)],
  ['POST', new RegExp(`^cases/${id}/assistant/messages$`)],
  ['GET', new RegExp(`^cases/${id}/assistant/search$`)],
  ['PATCH', new RegExp(`^cases/${id}/exposure$`)],
  ['GET|POST', new RegExp(`^cases/${id}/financial-intakes$`)],
  ['POST', new RegExp(`^cases/${id}/financial-intakes/existing$`)],
  ['POST', new RegExp(`^cases/${id}/financial-intakes/${id}/decision$`)],
  ['POST', new RegExp(`^cases/${id}/financial-review-confirmations$`)],
  ['GET', new RegExp(`^financial-intakes/${id}/original$`)],
  [
    'POST',
    new RegExp(
      `^cases/${id}/(documents|document-archives|review-runs|requests|waivers|assessments|questionnaires)$`,
    ),
  ],
  ['GET', new RegExp(`^cases/${id}/(readiness|history|assessments)$`)],
  ['GET|POST', new RegExp(`^cases/${id}/dossier-archives$`)],
  ['GET', new RegExp(`^dossier-archives/${id}$`)],
  ['GET', new RegExp(`^dossier-members/${id}/(source|extraction-summary)$`)],
  ['GET|POST', new RegExp(`^cases/${id}/financial-sets$`)],
  ['GET', new RegExp(`^cases/${id}/(financial-trends|financial-diagnostics)$`)],
  ['GET', new RegExp(`^cases/${id}/financial-import-sources$`)],
  ['POST', new RegExp(`^cases/${id}/(financial-imports|financial-files)$`)],
  ['GET', new RegExp(`^cases/${id}/financial-imports/${id}$`)],
  ['GET', new RegExp(`^cases/${id}/financial-reasoning/${id}$`)],
  ['POST', new RegExp(`^cases/${id}/financial-reasoning/${id}/decisions$`)],
  ['GET', new RegExp(`^financial-files/${id}/source$`)],
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
