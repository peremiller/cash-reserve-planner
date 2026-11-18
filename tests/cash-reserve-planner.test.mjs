import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const inlineScript = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
assert.ok(inlineScript, 'main inline app script must exist');
new vm.Script(inlineScript, {filename: 'cash-reserve-inline.js'});

function section(start, end) {
  const a = inlineScript.indexOf(start);
  const b = inlineScript.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'section must remain available: ' + start);
  return inlineScript.slice(a, b);
}

test('date and retirement age use actual local date, not a frozen 2026-06-15', () => {
  assert.match(inlineScript, /const TODAY = new Date\(\)/);
  assert.doesNotMatch(html, /max="2026-06-15"/);
  assert.match(inlineScript, /\$\("dob"\)\.max =/);
  const dates = vm.runInNewContext(
    'const TODAY = new Date(2026,10,12);' +
    section('function isValidDob', 'function load()') +
    ';({isValidDob,ageFromDob})', {Date});
  for (const [input, valid, age] of [
    ['1990-10-04', true, 36],
    ['2000-12-25', true, 25],
    ['2026-11-12', true, 0],
    ['2026-11-13', false, null],
    ['2026-02-30', false, null],
    ['2025-02-29', false, null],
    ['2024-02-29', true, 2],
    ['not-a-date', false, null],
  ]) {
    assert.equal(dates.isValidDob(input), valid, input);
    assert.equal(dates.ageFromDob(input)?.age ?? null, age, input);
  }
});

test('untrusted OAuth error and persisted sync timestamp cannot become HTML', () => {
  const statusEl = {
    className: '', textContent: '',
    set innerHTML(_v) { throw new Error('unsafe HTML assignment'); }
  };
  const gSetStatus = vm.runInNewContext(
    'const $ = () => statusEl;' +
    section('function gSetStatus', 'function getClientId') +
    ';gSetStatus', {statusEl});
  const payload = '<img src=x onerror=alert(1)>';
  gSetStatus(payload, 'err');
  assert.equal(statusEl.textContent, payload);
  assert.equal(statusEl.className, 'gstatus err');
  assert.match(inlineScript, /if \(!isValidDob\(iso\)\)/);
  assert.doesNotMatch(inlineScript, /el\.innerHTML = msg/);
});

test('labels, status announcements and keyboard navigation are present', () => {
  for (const id of ['dob','gClientId','retage','bufferBasis','spend',
                    'spendPeriod','assets','rungs']) {
    assert.ok(html.includes('for="' + id + '"'), 'missing label for ' + id);
  }
  assert.match(html, /<main[^>]+id="main-content"[^>]+tabindex="-1"/);
  assert.match(html, /href="#main-content">Skip to planner/);
  assert.match(html, /id="gStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /:focus-visible/);
  assert.match(html, /prefers-reduced-motion: reduce/);
});

test('financial inputs and existing persistent data keys remain unchanged', () => {
  assert.match(inlineScript, /const inputs = \["dob","retage","bufferBasis","spend","spendPeriod","assets","rungs","bufferSeparate"\]/);
  assert.match(inlineScript, /localStorage\.getItem\("crp"\)/);
  assert.match(inlineScript, /localStorage\.setItem\("crp", JSON\.stringify\(s\)\)/);
  for (const id of ['t-runway','t-buffer','ladderBody','q4Body']) {
    assert.ok(html.includes('id="' + id + '"'), 'missing existing output ' + id);
  }
});


function storageHarness({raw = null, readError = false, writeError = false} = {}) {
  const ids = ['dob','retage','bufferBasis','spend','spendPeriod','assets','rungs','bufferSeparate'];
  const nodes = Object.fromEntries(ids.map(id => [id, {type: id === 'bufferSeparate' ? 'checkbox' : 'text', value: '', checked: false}]));
  nodes.storageStatus = {hidden: true, textContent: '', set innerHTML(_) { throw Error('unsafe HTML assignment'); }};
  const writes = [];
  const localStorage = {
    getItem(key) { assert.equal(key, 'crp'); if (readError) throw Error('storage blocked'); return raw; },
    setItem(key, value) { assert.equal(key, 'crp'); if (writeError) throw Error('quota exceeded'); writes.push(value); }
  };
  const source = 'const inputs = ' + JSON.stringify(ids) + '; const $ = id => nodes[id]; ' +
    section('let plannerStorageWritable', 'function compute()') + ';({load,save})';
  const app = vm.runInNewContext(source, {nodes, localStorage});
  return {nodes, writes, app};
}

test('storage integrity: malformed saved record is neither replaced nor executed', () => {
  const h = storageHarness({raw: '{"dob":"2026-01-01",'});
  h.app.load();
  h.nodes.spend.value = '4500';
  h.app.save();
  assert.equal(h.writes.length, 0, 'existing malformed record must not be overwritten');
  assert.equal(h.nodes.spend.value, '4500', 'on-screen edits stay available');
  assert.equal(h.nodes.storageStatus.hidden, false);
  assert.match(h.nodes.storageStatus.textContent, /will not be overwritten/);
  assert.doesNotMatch(h.nodes.storageStatus.textContent, /2026-01-01/);
  assert.match(html, /id="storageStatus"[^>]*role="alert"[^>]*aria-live="assertive"/);
});

test('storage integrity: denied reads cannot destroy an unknown record', () => {
  const h = storageHarness({readError: true});
  h.app.load();
  h.app.save();
  assert.equal(h.writes.length, 0);
  assert.equal(h.nodes.storageStatus.hidden, false);
});

test('storage integrity: quota failures keep values visible and announce unsaved state', () => {
  const h = storageHarness({writeError: true});
  h.app.load();
  h.nodes.spend.value = '7100';
  h.app.save();
  h.app.save(); // no repeated destructive writes after first failure
  assert.equal(h.nodes.spend.value, '7100');
  assert.equal(h.writes.length, 0);
  assert.match(h.nodes.storageStatus.textContent, /not saved/);
});

test('storage integrity: valid records retain unknown fields and save only known input values', () => {
  const h = storageHarness({raw: JSON.stringify({spend: '6000', bufferSeparate: true, legacyNote: 'retain me', dob: {bad: true}})});
  h.app.load();
  assert.equal(h.nodes.spend.value, '6000');
  assert.equal(h.nodes.bufferSeparate.checked, true);
  assert.equal(h.nodes.dob.value, '', 'invalid saved object must not become an input value');
  h.nodes.spend.value = '6100';
  h.app.save();
  const saved = JSON.parse(h.writes[0]);
  assert.equal(saved.spend, '6100');
  assert.equal(saved.legacyNote, 'retain me');
  assert.equal(saved.bufferSeparate, true);
});

test('storage integrity: a new planner still saves defaults on first visit', () => {
  const h = storageHarness();
  h.app.load();
  h.nodes.spend.value = '5000';
  h.app.save();
  assert.equal(JSON.parse(h.writes[0]).spend, '5000');
  assert.equal(h.nodes.storageStatus.hidden, true);
});

test('Google client settings and sync timestamp handle unavailable localStorage without uncaught errors', () => {
  assert.match(inlineScript, /function getClientId\(\) \{ try \{/);
  assert.match(inlineScript, /try \{ localStorage\.setItem\("crp_gclient", cid\); \}/);
  assert.match(inlineScript, /try \{ localStorage\.setItem\("crp_gsynced", stamp\); \}/);
});
