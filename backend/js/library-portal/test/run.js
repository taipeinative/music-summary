// In-process runner also works in Windows environments that restrict child processes.
const fs = require('node:fs');
const path = require('node:path');
for (const file of fs.readdirSync(__dirname).filter((name) => name.endsWith('.test.js')).sort()) require(path.join(__dirname, file));
