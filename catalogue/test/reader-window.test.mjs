import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageWindow } from '../public/reader-window.mjs';

test('renders only visible mobile pages and one neighbour, not the whole catalogue', () => {
  assert.deepEqual(pageWindow(16, 484, 200, 60), { current: 0, indices: [0, 1, 2, 3] });
});
test('releases early pages after a jump while retaining nearby pages', () => {
  assert.deepEqual(pageWindow(4120, 484, 200, 60), { current: 19, indices: [19, 20, 21, 22, 18] });
});
test('clamps overscroll and the final page without out-of-range page requests', () => {
  assert.deepEqual(pageWindow(999999, 484, 200, 60), { current: 59, indices: [59, 58] });
  assert.deepEqual(pageWindow(-100, 484, 200, 1), { current: 0, indices: [0] });
});
test('page jumps survive browser rounding of fractional scroll offsets', () => {
  assert.equal(pageWindow(1098, 700, 200.5, 60).current, 5);
});
