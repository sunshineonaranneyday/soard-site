/**
 * Two admins editing one meeting in Board (the editor's 409 merge, board-shared.js mergeMeeting): the agenda merges as
 * one, each item by its id wherever it is. An item moved to another part is a move: never lost with someone's notes on
 * it, never in two parts at once. A part taken off while the other admin adds to it, or an item taken off while the
 * other changes it, asks (Keep mine / Take theirs), and either answer leaves the agenda whole.
 * QA, Nov 19 2026 (merge-check.mjs, merge-e2e.mjs, merge-e2e-dup.mjs). Made-up content only.
 * Run: node --test tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeMeeting, cleanMeeting } from '../public/admin/board-shared.js';

const base = cleanMeeting({
  id: 'm_merge01', date: '2026-12-01',
  sections: [
    { id: 's_a', title: 'Reports', items: [{ id: 'i_1', title: 'Finance', notes: 'n1' }, { id: 'i_2', title: 'Events', notes: 'n2' }] },
    { id: 's_b', title: 'New business', items: [{ id: 'i_5', title: 'Bylaws', notes: 'n5' }] },
  ],
  motions: [{ id: 'v_one001', text: 'Approve the budget' }], actions: [],
});
const copy = () => JSON.parse(JSON.stringify(base));
const merge = (mine, theirs, prefer) => mergeMeeting(base, cleanMeeting(mine), cleanMeeting(theirs), prefer ? { prefer } : {});
/** The agenda as "part[item:notes, …]" */
const shape = (m) => m.sections.map((s) => `${s.id}[${s.items.map((i) => `${i.id}:${i.notes}`).join(',')}]`).join(' ');
const ids = (m) => m.sections.flatMap((s) => s.items.map((i) => i.id));

test('an item moved to another part while the other admin edits it is moved, once, with both changes', () => {
  const moved = copy();
  moved.sections[1].items.push(moved.sections[0].items.shift()); // A: Finance to New business
  const edited = copy();
  edited.sections[0].items[0].notes = 'B changed the notes'; // B: Finance's notes
  for (const [mine, theirs, who] of [[edited, moved, 'B merging onto A'], [moved, edited, 'A merging onto B']]) {
    const { merged, clashes } = merge(mine, theirs);
    assert.deepEqual(clashes, [], who);
    assert.equal(shape(merged), 's_a[i_2:n2] s_b[i_5:n5,i_1:B changed the notes]', `${who}: moved, with the notes`);
    assert.equal(new Set(ids(merged)).size, ids(merged).length, `${who}: each item once`);
  }
  // A moves Finance out while B reorders what's left beside it: both
  const reordered = copy();
  reordered.sections[0].items.reverse();
  reordered.sections[1].items.unshift({ id: 'i_6', title: 'Gala', notes: 'n6' });
  const { merged, clashes } = merge(moved, reordered);
  assert.deepEqual(clashes, []);
  assert.equal(shape(merged), 's_a[i_2:n2] s_b[i_6:n6,i_5:n5,i_1:n1]');
});

test('a part one admin takes off while the other adds to it asks, and either answer leaves the agenda whole', () => {
  const gone = copy();
  gone.sections.pop(); // A: New business taken off (with Bylaws)
  const added = copy();
  added.sections[1].items.push({ id: 'i_9', title: 'Holiday party', notes: 'B added this' }); // B: an item in it
  // Either way round it asks about the part
  for (const [mine, theirs] of [[gone, added], [added, gone]]) assert.deepEqual(merge(mine, theirs).clashes, ['the part “New business”']);
  // A's answer: the part gone (Keep mine), or the part as B has it, with all its items (Take theirs)
  assert.equal(shape(merge(gone, added).merged), 's_a[i_1:n1,i_2:n2]');
  assert.equal(shape(merge(gone, added, 'theirs').merged), 's_a[i_1:n1,i_2:n2] s_b[i_5:n5,i_9:B added this]');
  // B's answer, the other way round
  assert.equal(shape(merge(added, gone).merged), 's_a[i_1:n1,i_2:n2] s_b[i_5:n5,i_9:B added this]');
  assert.equal(shape(merge(added, gone, 'theirs').merged), 's_a[i_1:n1,i_2:n2]');
  // An item moved into the part, or one in it changed, asks too; a part taken off with nothing done to it is just gone
  const into = copy();
  into.sections[1].items.push(into.sections[0].items.shift());
  assert.deepEqual(merge(gone, into).clashes, ['the part “New business”']);
  assert.equal(shape(merge(gone, into).merged), 's_a[i_1:n1,i_2:n2]', 'kept off: nobody took Finance off, so it stays where A has it');
  assert.equal(shape(merge(gone, into, 'theirs').merged), 's_a[i_2:n2] s_b[i_5:n5,i_1:n1]');
  const changed = copy();
  changed.sections[1].items[0].notes = 'B changed Bylaws';
  assert.deepEqual(merge(changed, gone).clashes, ['the part “New business”']);
  const untouched = copy();
  untouched.sections[0].items[0].notes = 'B elsewhere';
  const r = merge(untouched, gone);
  assert.deepEqual(r.clashes, []);
  assert.equal(shape(r.merged), 's_a[i_1:B elsewhere,i_2:n2]');
});

test('the same item moved two ways, or taken off one way and changed the other, asks; taken off and not changed, it goes', () => {
  // Both moved Events, to different places
  const toB = copy();
  toB.sections[1].items.push(toB.sections[0].items.pop());
  const toTop = copy();
  const ev = toTop.sections[0].items.pop();
  toTop.sections = [{ id: 's_c', title: 'Welcome', items: [ev] }, ...toTop.sections];
  const both = merge(toB, toTop);
  assert.deepEqual(both.clashes, ['“Events”']);
  assert.equal(shape(both.merged), 's_c[] s_a[i_1:n1] s_b[i_5:n5,i_2:n2]', 'mine: where I put it, once');
  assert.equal(shape(merge(toB, toTop, 'theirs').merged), 's_c[i_2:n2] s_a[i_1:n1] s_b[i_5:n5]', 'theirs: where they put it, once');
  // B took Events off; A changed its notes
  const off = copy();
  off.sections[0].items.pop();
  const noted = copy();
  noted.sections[0].items[1].notes = 'A’s new notes';
  for (const [mine, theirs] of [[noted, off], [off, noted]]) assert.deepEqual(merge(mine, theirs).clashes, ['“Events”']);
  assert.equal(shape(merge(noted, off).merged), 's_a[i_1:n1,i_2:A’s new notes] s_b[i_5:n5]');
  assert.equal(shape(merge(noted, off, 'theirs').merged), 's_a[i_1:n1] s_b[i_5:n5]');
  assert.equal(shape(merge(off, noted).merged), 's_a[i_1:n1] s_b[i_5:n5]');
  assert.equal(shape(merge(off, noted, 'theirs').merged), 's_a[i_1:n1,i_2:A’s new notes] s_b[i_5:n5]');
  // Taken off, and the other way didn't touch it: gone, nothing to ask
  const other = copy();
  other.sections[0].items[0].notes = 'Finance notes';
  const r = merge(other, off);
  assert.deepEqual(r.clashes, []);
  assert.equal(shape(r.merged), 's_a[i_1:Finance notes] s_b[i_5:n5]');
});

test('the order: one admin’s reorder stays while the other edits; both reordering the same part differently asks', () => {
  const reordered = copy();
  reordered.sections[0].items.reverse();
  const renamed = copy();
  renamed.sections[0].items[1].title = 'Events (B)';
  const r = merge(renamed, reordered);
  assert.deepEqual(r.clashes, []);
  assert.deepEqual(r.merged.sections[0].items.map((i) => `${i.id}:${i.title}`), ['i_2:Events (B)', 'i_1:Finance'], 'their order, my name');
  // The parts' order the same way
  const partsMoved = copy();
  partsMoved.sections.reverse();
  assert.deepEqual(merge(renamed, partsMoved).merged.sections.map((s) => s.id), ['s_b', 's_a']);
  // Both put the parts in different orders: asked
  const three = cleanMeeting({ ...base, sections: [...base.sections, { id: 's_c', title: 'Closing', items: [] }] });
  const one = JSON.parse(JSON.stringify(three)); one.sections = [one.sections[2], one.sections[0], one.sections[1]];
  const two = JSON.parse(JSON.stringify(three)); two.sections = [two.sections[1], two.sections[0], two.sections[2]];
  const both = mergeMeeting(three, cleanMeeting(one), cleanMeeting(two));
  assert.deepEqual(both.clashes, ['the order of the agenda']);
  assert.deepEqual(both.merged.sections.map((s) => s.id), ['s_c', 's_a', 's_b']);
  assert.deepEqual(mergeMeeting(three, cleanMeeting(one), cleanMeeting(two), { prefer: 'theirs' }).merged.sections.map((s) => s.id), ['s_b', 's_a', 's_c']);
});

test('a motion or action item taken off one way and changed the other asks too', () => {
  const off = copy();
  off.motions = [];
  const changed = copy();
  changed.motions[0].text = 'Approve the 2027 budget';
  const r = merge(changed, off);
  assert.deepEqual(r.clashes, ['“Approve the 2027 budget”']);
  assert.deepEqual(r.merged.motions.map((x) => x.text), ['Approve the 2027 budget']);
  assert.deepEqual(merge(changed, off, 'theirs').merged.motions, []);
  assert.deepEqual(merge(off, changed).clashes, ['“Approve the 2027 budget”']);
  assert.deepEqual(merge(off, changed).merged.motions, []);
});

// ─── QA round 2 (merge-e2e-lost-item.mjs, merge-cases.mjs, merge-fuzz-all.mjs) ───

test('an item both admins kept is never lost when one takes off the part it was moved into and the other the part it left', () => {
  const two = cleanMeeting({
    id: 'm_merge02', date: '2026-12-01',
    sections: [
      { id: 's_call', title: 'Call to order', items: [{ id: 'i_roll', title: 'Roll call', notes: 'Kept by both tabs' }] },
      { id: 's_year', title: 'Year in review', items: [{ id: 'i_make', title: 'Every makeover this year', notes: '' }] },
    ],
  });
  const like = () => JSON.parse(JSON.stringify(two));
  // Tab T takes off "Year in review"; tab M moves "Roll call" into it, then takes off "Call to order"
  const T = like(); T.sections = T.sections.filter((s) => s.id !== 's_year');
  const M = like(); M.sections[1].items.push(M.sections[0].items[0]); M.sections = M.sections.filter((s) => s.id !== 's_call');
  const m3 = (mine, theirs, prefer) => mergeMeeting(two, cleanMeeting(mine), cleanMeeting(theirs), prefer ? { prefer } : {});
  // M merging onto T: asked about the part (as before), and either answer keeps Roll call, once
  assert.ok(m3(M, T).clashes.includes('the part “Year in review”'));
  assert.equal(shape(m3(M, T).merged), 's_year[i_make:,i_roll:Kept by both tabs]', 'Keep mine: Year in review stays as M has it');
  assert.equal(shape(m3(M, T, 'theirs').merged), 's_call[i_roll:Kept by both tabs]', 'Take theirs: Year in review goes, Roll call stays where T has it');
  // T merging onto M (the mirror): the same, either answer
  assert.ok(m3(T, M).clashes.includes('the part “Year in review”'));
  assert.equal(shape(m3(T, M).merged), 's_call[i_roll:Kept by both tabs]', 'Keep mine: Roll call stays where T has it, with its part');
  assert.deepEqual(m3(T, M).clashes, ['the part “Year in review”', 'the part “Call to order”'], 'the part kept for it is named too');
  assert.equal(shape(m3(T, M, 'theirs').merged), 's_year[i_make:,i_roll:Kept by both tabs]');
});

test('both admins moving the same item into the same other part, at different places, asks where it goes', () => {
  const ab = cleanMeeting({ id: 'm_merge03', date: '2026-12-01', sections: [
    { id: 's_aaa', title: 'A', items: [{ id: 'i_x', title: 'X' }, { id: 'i_y', title: 'Y' }] },
    { id: 's_bbb', title: 'B', items: [{ id: 'i_p', title: 'P' }, { id: 'i_q', title: 'Q' }] },
  ] });
  const like = () => JSON.parse(JSON.stringify(ab));
  const first = like(); first.sections[1].items.unshift(first.sections[0].items.shift()); // X to the top of B
  const last = like(); last.sections[1].items.push(last.sections[0].items.shift()); // X to the end of B
  const order = (m) => m.sections.map((s) => `${s.id}[${s.items.map((i) => i.id).join(',')}]`).join(' ');
  const r = mergeMeeting(ab, cleanMeeting(first), cleanMeeting(last));
  assert.deepEqual(r.clashes, ['the order of the part “B”']);
  assert.equal(order(r.merged), 's_aaa[i_y] s_bbb[i_x,i_p,i_q]', 'Keep mine');
  assert.equal(order(mergeMeeting(ab, cleanMeeting(first), cleanMeeting(last), { prefer: 'theirs' }).merged), 's_aaa[i_y] s_bbb[i_p,i_q,i_x]', 'Take theirs');
  // Both put it in the same place: nothing to ask
  const same = mergeMeeting(ab, cleanMeeting(first), cleanMeeting(JSON.parse(JSON.stringify(first))));
  assert.deepEqual(same.clashes, []);
  // One moved it in, and the other reordered what was there while putting it in the same place: no clash either
  const swapped = like(); swapped.sections[1].items = [swapped.sections[0].items.shift(), swapped.sections[1].items[1], swapped.sections[1].items[0]];
  swapped.sections[0].items = swapped.sections[0].items.filter((i) => i.id !== 'i_x');
  const top = like(); top.sections[1].items.unshift(top.sections[0].items.shift());
  const q = mergeMeeting(ab, cleanMeeting(top), cleanMeeting(swapped));
  assert.deepEqual(q.clashes, []);
  assert.equal(order(q.merged), 's_aaa[i_y] s_bbb[i_x,i_q,i_p]');
});
