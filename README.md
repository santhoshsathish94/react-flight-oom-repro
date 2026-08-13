# Minimal repro — React Server Components memory leak under client-abort load

Next.js 16.2.12 · React 19.2.8 · Node 22+ · production build.

A `force-dynamic` async Server Component SSR-fetches a slow upstream and renders a large
list. Under load where clients **disconnect mid-render**, each **completed** render's fetch
response is retained and the heap grows without bound (until OOM). Only `--stack-trace-limit=0`
(or the one-line React fix in `./react-flight-oom-fix.patch`) prevents it.

## Run

```powershell
npm install
npm run build

# terminal 1 — slow upstream
npm run upstream

# terminal 2 — Next server with GC exposed
npm run start

# terminal 3 — flood with client-aborts, then read retained heap (post-GC)
$env:CONCURRENCY="40"; $env:ABORT_MS="60"; $env:REQUESTS="20000"
for ($r=1; $r -le 4; $r++) {
  node flood.js
  Start-Sleep -Seconds 5
  (Invoke-RestMethod http://127.0.0.1:3000/api/mem).heapUsedMB
}
```

## Expected vs fixed (controlled 4-round, 20k req/round, post-GC heapUsed)

| round | unpatched | `--stack-trace-limit=0` / patched React |
|------:|----------:|----------------------------------------:|
| 1 | ~540 MB | ~50 MB |
| 2 | ~1150 MB | ~40 MB |
| 3 | ~1250 MB | ~55 MB |
| 4 | ~1600 MB | ~70 MB (flat) |

## Root cause

See [`./FINDINGS.md`](./FINDINGS.md). In `react-server/src/ReactFlightServer.js`, on every
successful render completion React creates `new Error('This render completed successfully. All
cacheSignals are now aborted ...')` and stores it as `cacheController.signal.reason` for the
request's lifetime. Its captured synchronous stack retains the completed render's async /
cache scope (the `cache()` fetch-dedupe entries holding the fetch `Response` bodies). Creating
that benign, never-surfaced reason with **zero stack frames** eliminates the leak.
