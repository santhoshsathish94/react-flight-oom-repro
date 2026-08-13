// Minimal repro of the RSC memory leak.
// force-dynamic async Server Component that SSR-fetches a slow upstream, then renders
// a large list. Under load with clients disconnecting mid-render, the completed render's
// fetch response is retained (pinned by the stack of the "This render completed
// successfully..." Error that React uses to abort cacheSignals). Heap grows unbounded.
export const dynamic = 'force-dynamic'

export default async function Page({ params }) {
  const { id } = await params
  const res = await fetch(`http://127.0.0.1:9099/data/${id}`, { cache: 'no-store' })
  const items = await res.json()
  return (
    <main>
      <h1>Page {id}</h1>
      <ul>
        {items.map((it) => (
          <li key={it.i}>{it.v}</li>
        ))}
      </ul>
    </main>
  )
}
