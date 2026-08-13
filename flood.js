// Load generator: sends requests that DISCONNECT the client mid-render (at ABORT_MS,
// before the 400ms upstream responds). Env: PORT, FLOOD_PATH, CONCURRENCY, ABORT_MS,
// REQUESTS (cap; 0 = time-based), DURATION_MS.
const http = require('node:http')

const PORT = Number(process.env.PORT || 3000)
const FLOOD_PATH = process.env.FLOOD_PATH || '/p'
const DURATION_MS = Number(process.env.DURATION_MS || 30000)
const CONCURRENCY = Number(process.env.CONCURRENCY || 40)
const ABORT_MS = Number(process.env.ABORT_MS || 60)
const MAX_REQUESTS = Number(process.env.REQUESTS || 0)

let running = true
let finished = false
let sent = 0
function finish(reason) {
  if (finished) return
  finished = true
  running = false
  console.log(`flood done: ~${sent} requests sent (${reason})`)
  setTimeout(() => process.exit(0), 2000)
}
function one() {
  if (!running) return
  if (MAX_REQUESTS && sent >= MAX_REQUESTS) { finish('cap'); return }
  const id = Math.floor(Math.random() * 1e9)
  const req = http.get({ host: '127.0.0.1', port: PORT, path: `${FLOOD_PATH}/${id}` }, (res) => {
    res.on('data', () => {})
    res.on('end', () => { if (running) setImmediate(one) })
  })
  req.on('error', () => { if (running) setImmediate(one) })
  sent++
  setTimeout(() => req.destroy(), ABORT_MS) // disconnect mid-render
}

for (let i = 0; i < CONCURRENCY; i++) one()
setTimeout(() => finish('time'), DURATION_MS)
