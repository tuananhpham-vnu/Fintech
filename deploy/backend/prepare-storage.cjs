'use strict'
const fs = require('node:fs')
const path = require('node:path')

// Deployment provisioning, not an alternative to PrivateDocumentFiles guards.
// Keep this layout synchronized with Dockerfile and render.yaml. Never recursively
// create arbitrary configured paths, follow aliases or repair existing permissions.
function prepareStorage(storageRoot, ledgerRoot) {
  const base = '/var/lib/aic'
  if (storageRoot !== `${base}/private` || ledgerRoot !== `${base}/ledger`)
    throw new Error('Private storage provisioning requires the Render Blueprint paths')
  const directories = [storageRoot, ledgerRoot, `${storageRoot}/cache`]
  const check = (name, privateDirectory) => {
    const info = fs.lstatSync(name, { bigint: true })
    if (!info.isDirectory() || info.isSymbolicLink() ||
        fs.realpathSync.native(name) !== name || info.ino === 0n)
      throw new Error('Private storage provisioning refused an unsafe directory')
    if (privateDirectory &&
        (info.uid !== BigInt(process.geteuid()) || (info.mode & 0o777n) !== 0o700n))
      throw new Error('Private storage provisioning requires owner-only directories')
  }
  const checkAncestors = (name) => {
    const components = [name]
    while (path.dirname(components[0]) !== components[0])
      components.unshift(path.dirname(components[0]))
    for (const component of components)
      check(component, component === base || component.startsWith(`${base}/`))
  }
  checkAncestors(base)
  // Reject unsafe existing entries before creating anything.
  for (const name of directories) {
    try { checkAncestors(name) } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  for (const name of directories) {
    checkAncestors(path.dirname(name))
    try { fs.mkdirSync(name, { mode: 0o700 }) } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    checkAncestors(name)
  }
}

module.exports = { prepareStorage }
