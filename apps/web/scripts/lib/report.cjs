const fs = require('node:fs')
const path = require('node:path')

const directory = path.resolve(__dirname, '../../.reports')

function writeReport(name, value) {
  if (name !== path.basename(name) || !name.endsWith('.json')) {
    throw new Error('Report filename must be a JSON basename')
  }
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n')
}

module.exports = { writeReport }
