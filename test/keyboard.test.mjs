import test from 'node:test';
import assert from 'node:assert/strict';

import { keepKeyInsideCell } from '../src/keyboard.mjs';

function createEvent(key) {
  return {
    key,
    propagationStopped: false,
    defaultPrevented: false,
    stopPropagation() {
      this.propagationStopped = true;
    },
    preventDefault() {
      this.defaultPrevented = true;
    }
  };
}

test('keeps Backspace inside the active table cell', () => {
  const event = createEvent('Backspace');

  assert.equal(keepKeyInsideCell(event), true);
  assert.equal(event.propagationStopped, true);
  assert.equal(event.defaultPrevented, false);
});

test('continues to isolate Tab navigation from the outer editor', () => {
  const event = createEvent('Tab');

  assert.equal(keepKeyInsideCell(event), true);
  assert.equal(event.propagationStopped, true);
});

test('allows unrelated keydown events to reach the outer editor', () => {
  const deleteEvent = createEvent('Delete');
  const arrowEvent = createEvent('ArrowLeft');

  assert.equal(keepKeyInsideCell(deleteEvent), false);
  assert.equal(keepKeyInsideCell(arrowEvent), false);
  assert.equal(deleteEvent.propagationStopped, false);
  assert.equal(arrowEvent.propagationStopped, false);
});
