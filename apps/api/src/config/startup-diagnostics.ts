export type StartupStage = 'CONFIG' | 'APPLICATION' | 'LISTEN'

/** Fixed diagnostics only: never print URLs, SQL, filesystem contents or raw errors. */
export function startupFailure(error: unknown, stage: StartupStage): string {
  const failure = error as { code?: unknown; message?: unknown }
  const code = typeof failure?.code === 'string' ? failure.code : ''
  const message = typeof failure?.message === 'string' ? failure.message : ''
  let detail = 'UNEXPECTED'
  let advice = 'Check the API configuration and local service dependencies.'
  const invalid = /^Invalid ([A-Z][A-Z0-9_]{1,63})(?: configuration)?$/.exec(
    message,
  )
  if (invalid) {
    detail = 'INVALID_' + invalid[1]
    advice = `Check ${invalid[1]} in the root .env.`
  } else if (stage === 'CONFIG' && code === 'ENOENT') {
    detail = 'CONFIG_FILE_MISSING'
    advice =
      'Check AIC_FHI_POLICY_PATH; relative paths must start at the repository root.'
  } else if (stage === 'CONFIG' && code === 'EACCES') {
    detail = 'CONFIG_FILE_ACCESS'
    advice =
      'The configured policy file cannot be read by this Windows account.'
  } else if (stage === 'CONFIG' && error instanceof SyntaxError) {
    detail = 'CONFIG_JSON_INVALID'
    advice = 'Check the JSON in the configured AIC_FHI_POLICY_PATH file.'
  } else if (
    message === 'Invalid or incompatible AIC_FHI_POLICY_PATH approval artifact'
  ) {
    detail = 'FHI_POLICY_INVALID'
    advice =
      'The configured policy file does not match the current scoring method.'
  } else if (
    ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', '28P01', '3D000'].includes(code)
  ) {
    detail = 'DATABASE_CONNECTION'
    advice = 'Check DATABASE_URL and the configured API database connection.'
  } else if (code === 'EADDRINUSE') {
    detail = 'PORT_IN_USE'
    advice = 'The API port is already occupied by another process.'
  } else if (message.startsWith('Private document cache failed:')) {
    detail = 'PRIVATE_STORAGE'
    advice = 'Check AIC_STORAGE_DIR and its private filesystem permissions.'
  } else if (
    message ===
    'Database migrations are not current; run the explicit migration runner'
  ) {
    detail = 'DATABASE_MIGRATIONS'
    advice =
      'The API database must have the same migrations as the prepared local database.'
  }
  return `API startup failed [${stage}/${detail}]. ${advice}\n`
}
