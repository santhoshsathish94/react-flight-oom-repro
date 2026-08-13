// Reports retained heap after forcing GC (requires `node --expose-gc`).
import v8 from 'node:v8'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (typeof global.gc === 'function') {
    try { global.gc(); global.gc() } catch {}
  }
  const m = process.memoryUsage()
  return Response.json({
    rssMB: Math.round(m.rss / 1048576),
    heapUsedMB: Math.round(m.heapUsed / 1048576),
    heapTotalMB: Math.round(m.heapTotal / 1048576),
  })
}
