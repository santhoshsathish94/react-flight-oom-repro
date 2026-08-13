// Slow upstream: responds after 400ms with ~100KB JSON (2000 items).
const http = require('node:http')

const DELAY_MS = 400
const ITEMS = 2000
const PORT = 9099
const payload = JSON.stringify(
  Array.from({ length: ITEMS }, (_, i) => ({ i, v: 'x'.repeat(40) + i })),
)

http
  .createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(payload)
    }, DELAY_MS)
  })
  .listen(PORT, () => console.log(`[upstream] :${PORT} delay=${DELAY_MS}ms items=${ITEMS}`))
