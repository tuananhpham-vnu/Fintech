// Test-only ports; both services always stay on loopback.
function readPort(name, fallback) {
  const value = process.env[name] ?? String(fallback)
  const port = Number(value)
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid ' + name)
  return port
}
const port = readPort('AIC_QA_PORT', 4800)
const uiPort = readPort('AIC_QA_UI_PORT', 3001)
if (port === uiPort) throw new Error('QA and UI must use different ports')
module.exports = { port, uiPort, origin: `http://127.0.0.1:${port}` }
