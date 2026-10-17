export function safeReturnTo(path: string | null) {
  return path && /^\/(cases|counterparties)(\/|\?|$)/.test(path) && !path.includes('\\')
    ? path
    : '/cases'
}
