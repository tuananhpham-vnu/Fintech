// A bounded diagnostic run; never converts a provider failure into a mock/retry success.
const MODEL = 'gemini-3.1-flash-lite'
const STOP_CATEGORIES = new Set([
  'RATE_LIMIT_OR_QUOTA',
  'UPSTREAM_AUTH_REJECTED',
  'UPSTREAM_NOT_FOUND',
  'PROVIDER_CONFIGURATION_MISSING',
])
function mayDispatch(events, previousPassed) {
  return previousPassed && !events.some((event) => STOP_CATEGORIES.has(event.category))
}
function assertModel(actual, expected = MODEL) {
  if (actual !== expected) throw new Error('Live model provenance does not match requested model')
}
module.exports = { MODEL, mayDispatch, assertModel }
