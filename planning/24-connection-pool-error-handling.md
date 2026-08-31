# 24 — Connection Pool Error Handling

**Status:** proposed
**Severity:** critical — a single slow query can kill the server process
**Affects:** `src/connections/drivers/postgres.ts` (confirmed), `src/connections/drivers/mysql.ts` (same class, unconfirmed)
**Found in:** v1.4.1, in production at HRT Club (`company-internal` / analytics)

## Summary

`PostgresDriver` creates a `pg.Pool` and never attaches an `error` listener to
it. `pg.Pool` is an `EventEmitter`, and when an **idle** pooled client receives
an error from the server, pg-pool re-emits it on the pool. An EventEmitter that
emits `'error'` with no listener throws — which, in Node, means an uncaught
exception and process exit.

The result is that a normal, expected server-side event — a query hitting
`statement_timeout` — takes down the entire Orrery server. Not the query, not
the request: the process.

## The incident

HRT Club's analytics deployment, 2026-08-03 21:15:19 UTC. A dashboard query ran
the full 30s and hit the server-side `statement_timeout` that this driver itself
sets (line 17, `statement_timeout: this.queryTimeoutMs`). Postgres cancelled the
statement and sent back SQLSTATE `57014`.

By the time the cancellation arrived, the query had already returned and the
client had been released back to the pool. So the error landed on an idle client
with no query-level handler in scope:

```
node:events:502  throw er; // Unhandled 'error' event
      ^
error: canceling statement due to statement timeout
    at parseErrorMessage (/app/node_modules/pg-protocol/dist/parser.js:305:11)
    ...
  Emitted 'error' event on BoundPool instance at:
    at Client.idleListener (/app/node_modules/pg-pool/index.js:62:10)
{
  severity: 'ERROR',
  code: '57014',
  routine: 'ProcessInterrupts',
  ...
}
Node.js v20.20.2
```

Process exited. Downstream, the deployment served 502s for ~28 hours. (The
28 hours were the operator's own fault — a TCP health check on an auth sidecar's
port, since fixed on their end. The 5 seconds between "slow query" and "process
dead" are ours.)

## Root cause

`src/connections/drivers/postgres.ts:31`

```ts
this.pool = new pg.Pool(poolConfig);
```

No `this.pool.on("error", ...)`. pg-pool's `makeIdleListener`
(`node_modules/pg-pool/index.js`, ~line 50) is unambiguous about what it does
with an idle-client error — it purges the client, then re-emits on the pool:

```js
function makeIdleListener(pool, client) {
  return function idleListener(err) {
    ...
    pool._remove(client)
    // TODO - document that once the pool emits an error
    // the client has already been closed & purged and is unusable
    pool.emit('error', err, client)
  }
}
```

Any consumer of `pg.Pool` must therefore subscribe to `error`, or inherit a
process crash on a routine server-side event.

Note the driver is not merely *permitting* this — it is *provoking* it. Setting
`statement_timeout` server-side guarantees that long queries produce exactly the
async error that has no handler. The two lines are eleven apart.

## The fix

Attach an error handler at pool creation:

```ts
this.pool = new pg.Pool(poolConfig);

// pg.Pool is an EventEmitter. An idle client can fail asynchronously — most
// commonly when the server cancels a statement that has already returned
// (statement_timeout, SQLSTATE 57014), but also on network drops and
// administrator termination. There is no caller left to reject at that point,
// so without this listener Node treats it as an unhandled 'error' event and
// exits the process. Losing a pooled connection is recoverable; the pool will
// open a fresh one on the next checkout.
this.pool.on("error", (err) => {
  console.error(`[postgres] idle client error (connection discarded): ${err.message}`);
});
```

That is the whole required change. It is a strict improvement with no behavioral
downside: pg-pool already removes the failed client from the pool, and in-flight
`pool.query()` calls still reject through their own promise as they do today.

### Scope checklist

- [ ] `postgres.ts` — attach `pool.on("error")` (**required**; fixes the crash)
- [ ] `mysql.ts` — same audit. `mysql.createPool()` at line 13/19 likewise has
      no error listener. mysql2 routes most failures to the query callback, so
      this is lower-risk than the pg case, but a pool-level `error` event there
      is unhandled for the same reason. Confirm before changing.
- [ ] `duckdb.ts` / `sqlite.ts` — in-process, no pool, no network. Expected to
      be unaffected; confirm and move on.
- [ ] Regression test — see below.
- [ ] Consider surfacing the timeout to the user (see "Related, not required").

### Test

The failure is an async event on an idle client, so a plain `pool.query()` test
will not reproduce it. Reproduce by emitting on the pool directly, which is what
pg-pool's `idleListener` does:

```ts
it("survives an error emitted on an idle pooled client", async () => {
  const driver = new PostgresDriver();
  await driver.connect(config);
  // Must not throw / must not kill the process.
  (driver as any).pool.emit("error", Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }));
  expect(driver.isConnected()).toBe(true);
});
```

An integration-flavored version — `SET statement_timeout = 100` then
`SELECT pg_sleep(1)` against a real Postgres — reproduces the true sequence and
is worth having if the suite already has a live-Postgres lane.

## Related, not required

Two things this incident exposed that are separate calls, not part of the fix:

1. **The timeout is invisible to the user.** When a query exceeds
   `statement_timeout`, the dashboard panel gets a generic failure. Reporting
   "this query exceeded the 30s timeout" would have pointed HRT Club at the
   offending panel immediately instead of via a stack trace in CloudWatch.

2. **`query()` has no per-query guard.** The driver relies entirely on the
   server-side `statement_timeout`. That is reasonable, but it means the
   client-side `queryTimeoutMs` field is only ever used to configure the server
   and the connection timeout — worth a comment, or a client-side race like
   `mysql.ts` already does.

## Consumer note

HRT Club's `company-internal` repo has shipped its own mitigations for this
(process supervision in `services/analytics/start.sh` + an upstream-aware
`/healthz` on the auth sidecar), so a crash there now recycles the instance in
seconds rather than hanging until someone notices. Those are backstops against
*any* crash. They do not fix this bug, and the crash still drops every in-flight
dashboard request. This should still be fixed here.

Once released, bump the base image tag and update
`company-internal/services/analytics/Dockerfile`'s `FROM` (currently
`ci-zofkelncvz-openboard-base-repo:1.4.1`).
