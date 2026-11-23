/**
 * Two operations against one D1 shim, one held just before one of its statements while the other runs to its end
 * (Advisory Board QA round 21's proof, the tester's sqlslow method made exact): a write about a member and a People
 * rename, each held at every statement it makes in turn, both ways round. A batch is one statement here, as D1 runs
 * it: all of it at once.
 *   const h = holdable(rawDB); env.DB = h.DB;
 *   await h.count('write', fn)                         how many statements fn makes
 *   await h.heldAt('write', k, fn, other)              fn held before its k-th, other() run to its end, fn let go
 *     → { hit, first: { ok } | { err }, second: { ok } | { err } }   (hit: fn reached its k-th statement at all)
 */
import { AsyncLocalStorage } from 'node:async_hooks';

// (one for every run: each AsyncLocalStorage made stays hooked into every promise after it, so one a run slows each
// run after it)
const als = new AsyncLocalStorage();

export function holdable(raw) {
  const state = { counts: {}, hold: null };
  const gate = async () => {
    const op = als.getStore();
    if (!op) return;
    const n = (state.counts[op] = (state.counts[op] || 0) + 1);
    const h = state.hold;
    if (h && h.op === op && h.k === n) { h.reached(); await h.until; }
  };
  const wrap = (st) => ({
    ...st,
    bind: (...p) => wrap(st.bind(...p)),
    first: async (c) => { await gate(); return st.first(c); },
    all: async () => { await gate(); return st.all(); },
    run: async () => { await gate(); return st.run(); },
  });
  const DB = { ...raw, prepare: (sql) => wrap(raw.prepare(sql)), batch: async (stmts) => { await gate(); return raw.batch(stmts); } };
  const settle = (p) => p.then((ok) => ({ ok }), (err) => ({ err }));
  return {
    DB,
    as: (op, fn) => als.run(op, fn),
    async count(op, fn) {
      state.counts = {};
      state.hold = null;
      const r = await settle(als.run(op, fn));
      return { n: state.counts[op] || 0, ...r };
    },
    async heldAt(op, k, fn, other) {
      state.counts = {};
      let reached;
      const at = new Promise((res) => { reached = res; });
      let release;
      const until = new Promise((res) => { release = res; });
      state.hold = { op, k, reached, until };
      const first = settle(als.run(op, fn));
      const hit = await Promise.race([at.then(() => true), first.then(() => false)]);
      const second = await settle(als.run(`${op}-other`, other));
      state.hold = null;
      release();
      return { hit, first: await first, second };
    },
  };
}
