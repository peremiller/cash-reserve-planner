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
  for (const id of ['runway','t-buffer','ladderBody','q4Body']) {
    assert.ok(html.includes('id="' + id + '"'), 'missing existing output ' + id);
  }
});
