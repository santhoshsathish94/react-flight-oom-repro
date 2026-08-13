# Next.js RSC OOM — End-to-End Analysis

Repro: `_upstream/next-oom-repro` (Next 16.2.12, React 19.2.8, **Turbopack** build, Node 25 local).
Route `/p/[id]`: `force-dynamic` async Server Component that `await fetch(slow-upstream, {cache:'no-store'})`
then renders 2000 items. Load generator (`flood.js`) sends requests and **disconnects the client at 60ms**
(`req.destroy()`), while the upstream takes 400ms.

## 1. Request flow (traced live, VERBOSE=1 in page.js)

Normal request (no disconnect):
```
[REQ] start -> fetch-start(+1ms) -> fetch-ok 200(+451ms) -> json-done n=2000 -> render-return(+455ms)
```
Client-aborted request (client gone at 60ms):
```
[REQ] start -> fetch-start(+0ms) -> fetch-ok 200(+417ms) -> json-done n=2000 -> render-return(+420ms)
```

**Key fact:** the render is NOT aborted and the fetch is NOT cancelled on client disconnect. The Server
Component runs to completion (~420ms) against a dead socket. There is **no error in the render/fetch path**
for the dominant case. (Under heavier connection pressure, some fetches instead fail with
`TypeError: fetch failed` / `ECONNRESET`, but the leak reproduces without any such error.)

## 2. What leaks (heap snapshot, post-GC)

Retained objects are the **undici fetch responses**: `_Response`, `InternalReadableByteStream`,
`ReadableByteStreamController`, `ReadableStreamDefaultReader`, plus the parsed 2000-item arrays and buffers.
Corrected retainer analysis (weak edges excluded, `analyze-retainers3.js`): 1116/1117 `_Response` trace to
the **React `cache()` dedupe trie** (`Map` of url→entry) created by Next's `createDedupeFetch`
(`next/dist/server/lib/dedupe-fetch.js`), whose per-request cache node is retained past request end.

## 3. It is stack-mediated — VERIFIED (controlled 4-round, 20k req/round)

| round | unpatched | `--stack-trace-limit=0` (F1) |
|------:|----------:|-----------------------------:|
| 1 | 625 MB | 40 MB |
| 2 | 1225 MB | 36 MB |
| 3 | 1248 MB | 68 MB |
| 4 | 1276 MB | 68 MB |

F1 keeps it flat. Only `--stack-trace-limit=0` works; `--no-async-stack-traces` does **not** (tested) — so the
pin is **synchronous** stack-frame capture, not async-stack linking. Mechanism: an Error created in the
disconnect/response path captures a stack whose CallSites retain the request's async context / dedupe-cache
node; F1 → zero frames → node unreachable after the request → responses collected.

## 4. Ruled out (each tested on loaded code)

- **Fix A** — drop `ResponseAborted.stack`: no effect. `ResponseAborted` is created in
  `createAbortController`'s `response.once('close')` handler → its stack is socket-close internals, not the render.
- **Dedupe-clone cancel** (`dedupe-fetch.js` `entry[2]=cloned2`): no effect.
- **Null `task.model`/`task.thenableState`** in React Flight `abortTask`/`erroredTask`: no effect — and
  instrumentation (stderr markers) proved those handlers **never fire** for this leak (renders complete).
- **App Insights**: A/B identical — passenger, not cause.
- Non-determinism note: a single light run sometimes drains to ~30MB; only **multi-round** load reliably
  accumulates. Always verify with the 4-round method (earlier single-run F1 "fixes" risked drain-luck; the
  controlled test above confirms F1 is real).

## 5. ROOT CAUSE (found + validated)

A `TRACE_ERR=1` hook (subclass-safe `global.Error` override) enumerated every Error created during aborted
requests. Each **completed** request creates, on the completion path (not the render), two errors:
`Error: This render completed successfully. All cacheSignals are now aborted...` and `Error: Connection closed.`

**The pin is the first one.** In `react-server/src/ReactFlightServer.js` (~line 6523), when the render finishes
(`request.pendingChunks === 0 && request.status < ABORTING`):
```js
const abortReason = new Error('This render completed successfully. All cacheSignals are now aborted ...');
request.cacheController.abort(abortReason);
```
Every successful render creates this `Error` (with a full synchronous stack) and stores it as
`cacheController.signal.reason` for the request's lifetime. Its captured CallSites retain the completed render's
async context / cache scope — i.e. the React `cache()` fetch-dedupe entries holding the undici `_Response`
bodies. This explains all observations: renders complete cleanly (error is on the *completion* path), only
`--stack-trace-limit=0` (synchronous frames) fixes it, and the retained objects are fetch responses.

### Validated fix (scoped, no global flag)
Create that abort reason with **zero stack frames** (only this Error). Back-to-back A/B, controlled 4-round
(20k req/round), same machine/session:

| round | baseline (pristine) | scoped fix |
|------:|--------------------:|-----------:|
| 1 | 542 MB | 54 MB |
| 2 | 1141 MB | 36 MB |
| 3 | 1111 MB | 55 MB |
| 4 | 1615 MB | 69 MB |

Upstream React fix (`ReactFlightServer.js`): wrap that one `new Error(...)` in `Error.stackTraceLimit = 0`
(save/restore) so the benign, never-surfaced cleanup reason carries no stack. (Alternative: a module-level
singleton reason created once. The `Connection closed.` error in `ReactFlightClient.js` is a possible secondary
case — test if a residual remains.) Repro patch: `patch-fix.js` (turbo bundle). Real diff applied to
`_upstream/react/packages/react-server/src/ReactFlightServer.js`.

## Verified mitigation (ship today)
`NODE_OPTIONS=--stack-trace-limit=0` — flat ~68MB vs ~1.3GB. Costs error-stack detail in telemetry; no scoped
flag variant exists.
