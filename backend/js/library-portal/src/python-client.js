const { spawn } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');
const fs = require('node:fs');

async function pythonTransaction(config, metadata, callback) {
  const localPython = path.join(__dirname, '../.venv/Scripts/python.exe');
  const executable = process.env.LIBRARY_PORTAL_PYTHON || process.env.LIBRARY_MANAGER_PYTHON || (fs.existsSync(localPython) ? localPython : 'python');
  const child = spawn(executable, ['-u', path.join(__dirname, 'python-worker.py')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let pending = null;
  let stderr = '';
  let ended = null;
  child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-8000); });
  const reject = (error) => { ended = error; if (pending) { pending.reject(error); pending = null; } };
  child.on('error', reject);
  child.on('exit', (code) => reject(new Error(`Python worker exited (${code}). ${stderr}`)));
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      const response = JSON.parse(line);
      if (pending) {
        const waiter = pending; pending = null;
        response.error ? waiter.reject(new Error(response.error)) : waiter.resolve(response);
      }
    } catch (error) { reject(error); }
  });
  const send = (message) => new Promise((resolve, rejectPromise) => {
    if (ended) return rejectPromise(ended);
    if (pending) return rejectPromise(new Error('Concurrent Python queries are not supported.'));
    pending = { resolve, reject: rejectPromise };
    child.stdin.write(JSON.stringify(message) + '\n');
  });
  const timer = setTimeout(() => { reject(new Error('Python transaction timed out; verify the result before retrying.')); child.kill(); }, 120000);
  try {
    await send({ command: 'begin', config, metadata });
    const client = { query: (sql, params = []) => send({ command: 'query', sql, params }), confirm: (mappings) => send({ command: 'confirm', mappings }) };
    const result = await callback(client);
    await send({ command: 'commit' });
    return result;
  } catch (error) {
    if (!ended) await send({ command: 'rollback' }).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    child.stdin.end();
  }
}
module.exports = { pythonTransaction };
