/**
 * Keys whose native contenteditable behavior belongs to the current table cell,
 * but whose events must not reach Editor.js' block-level keyboard handling.
 *
 * @param {KeyboardEvent} event - keydown event
 * @returns {boolean}
 */
export function keepKeyInsideCell(event) {
  if (!event || (event.key !== 'Tab' && event.key !== 'Backspace')) {
    return false;
  }

  event.stopPropagation();
  return true;
}
