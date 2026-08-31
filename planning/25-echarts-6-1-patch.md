# 25 — ECharts 6.1.0 Security Patch

> **Status:** Proposed — **security**. Filed 2026-08-14 from Libration's Phase 01
> setup, which surfaced the advisory family-wide.
>
> **Effort: minutes.** `package.json` already declares `^6.0.0`; only the lockfile
> is behind. This is not a major upgrade — see doc 18 in the Almagest repo for the
> one that is.

## Objective

Move Orrery's resolved `echarts` from **6.0.0 → 6.1.0** to clear
[GHSA-fgmj-fm8m-jvvx](https://github.com/advisories/GHSA-fgmj-fm8m-jvvx).

## The advisory

Cross-site scripting in Apache ECharts, **moderate severity, all versions
`< 6.1.0`**, fixed in `6.1.0`.

The `lines` series' built-in tooltip renders `series.data[i].name` through
`innerHTML` **without escaping**. Every other built-in tooltip formatter escapes;
this one code path missed it. It fires when all four hold:

1. a `lines` series is rendered, **and**
2. `tooltip` is enabled, **and**
3. no custom `tooltip.formatter` is supplied, **and**
4. `series.data[i].name` carries attacker-controlled HTML

Note this is the `lines` series (the geo/graph flight-path type), **not** the
ordinary `line` series. That narrows it considerably.

## Why Orrery is exposed

Two facts combine:

- `src/server/routes/dashboard.ts` serves **`echarts/dist/echarts.min.js`** — the
  full barrel bundle — from `/orrery/vendor/echarts.min.js`. Orrery does not
  tree-shake, so the `lines` series is present and registerable regardless of
  whether any board currently uses it.
- Boards are **user-authored `.board` files**, and chart `type` flows from the
  board into the ECharts option. A board can therefore ask for `lines`, and the
  `name` values in it come from **query results** — i.e. from the source database.

So the realistic threat is stored XSS: a row value in a connected database reaches
a `lines` tooltip and executes in the viewer's browser. That requires a board using
`lines` in the first place, which is why this is moderate rather than urgent — but
Orrery has production users and serves the vulnerable code path to every one of
them, so it should not sit.

At the time of writing, `grep` finds no `lines` usage in `src/` or `templates/`.
That is not a guarantee about **customer** boards.

## The fix

`package.json` already has `"echarts": "^6.0.0"`, which permits 6.1.0. The
installed tree is pinned at 6.0.0 by `package-lock.json`. So:

```sh
npm update echarts
npm audit          # expect: found 0 vulnerabilities
```

Tightening the range to `^6.1.0` is optional but worth doing so a fresh
`npm install` on a clean checkout can't resolve back to a vulnerable 6.0.x.

## Tasks

- [ ] `npm update echarts` → resolved 6.1.0; commit the lockfile
- [ ] Optionally tighten `package.json` to `"echarts": "^6.1.0"`
- [ ] `npm audit` reports 0 vulnerabilities
- [ ] Run the existing test + E2E suites — 6.0 → 6.1 is a patch-level bump within
      the same major, so no rendering changes are expected. Confirm rather than assume.
- [ ] Verify `/orrery/vendor/echarts.min.js` serves the new bundle and that the
      in-process `echartsBundleCache` ETag changes (it keys off file size + mtime,
      so it should invalidate on its own — check, don't trust)
- [ ] Cut a patch release; this ships to production users

## Not in scope

Tree-shaking the vendored bundle. Orrery deliberately serves the full barrel so any
board can use any chart type without a rebuild — that is the right call for a
code-defined tool and this advisory is not a reason to revisit it. Tracked nowhere;
mentioned only so the next reader doesn't think it was overlooked.

## Cross-repo context

Same advisory, three repos, three different amounts of work:

| Repo | Was | Action | Effort |
|---|---|---|---|
| **Orrery** (here) | 6.0.0 | lockfile bump | minutes |
| **Almagest** (`../folio`) | 5.6.0 | **major 5 → 6 migration** — see its planning doc 18 | real work |
| **Libration** (`../libration`) | — | pinned `^6.1.0` at scaffold time; done | none |

Armillary has no `echarts` dependency and needs nothing.

Orrery was already the furthest ahead here — it was on 6.x while Almagest was still
on 5.x. Worth noting for the "pin to match the siblings" rule in Libration's
`CONTRIBUTING.md`: **6.1.0 is now the family's target**, and Almagest is the laggard,
not the reference.
