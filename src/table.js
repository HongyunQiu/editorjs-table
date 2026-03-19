import Toolbox from './toolbox';
import * as $ from './utils/dom';
import throttled from './utils/throttled';
import { assetizeTableCellElement, normalizeTableCellHtml } from './pasteImageAssetization.mjs';

import {
  IconDirectionLeftDown,
  IconDirectionRightDown,
  IconDirectionUpRight,
  IconDirectionDownRight,
  IconCross,
  IconPlus,
  IconClipboard
} from '@codexteam/icons';

const CSS = {
  wrapper: 'tc-wrap',
  wrapperReadOnly: 'tc-wrap--readonly',
  copyHighlight: 'tc-wrap--copy-highlight',
  table: 'tc-table',
  row: 'tc-row',
  withHeadings: 'tc-table--heading',
  rowSelected: 'tc-row--selected',
  cell: 'tc-cell',
  cellMedia: 'tc-cell--media',
  cellSelected: 'tc-cell--selected',
  cellFocus: 'tc-cell--focus',
  cellDragFocus: 'tc-cell--drag-focus',
  addRow: 'tc-add-row',
  addRowDisabled: 'tc-add-row--disabled',
  addColumn: 'tc-add-column',
  addColumnDisabled: 'tc-add-column--disabled',
  copyButton: 'tc-copy-btn',
  copyButtonCopied: 'tc-copy-btn--copied',
};

const ICON_CHECK = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 6L9 17l-5-5"/></svg>';

function extractImageFilesFromDataTransfer(dt) {
  if (!dt) {
    return [];
  }

  const out = [];
  const seen = new Set();

  const pushFile = (file) => {
    if (!file || !file.type || !/^image\//i.test(String(file.type))) {
      return;
    }

    const key = [
      String(file.name || ''),
      String(file.type || ''),
      Number(file.size || 0)
    ].join('::');

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    out.push(file);
  };

  const items = dt.items ? Array.from(dt.items) : [];
  items.forEach((item) => {
    if (!item || item.kind !== 'file' || !/^image\//i.test(String(item.type || ''))) {
      return;
    }
    const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
    pushFile(file);
  });

  const files = dt.files ? Array.from(dt.files) : [];
  files.forEach((file) => pushFile(file));

  return out;
}

function getUploader(config) {
  const uploader = config && config.uploader && typeof config.uploader === 'object'
    ? config.uploader
    : null;

  return uploader || {};
}

function getUploadedUrl(result) {
  if (!result || typeof result !== 'object') {
    return '';
  }

  if (result.file && typeof result.file.url === 'string' && result.file.url) {
    return result.file.url;
  }

  if (typeof result.url === 'string' && result.url) {
    return result.url;
  }

  return '';
}

function insertHtmlAtSelection(cell, html) {
  const safeHtml = String(html || '');
  if (!safeHtml) {
    return;
  }

  const selection = window.getSelection && window.getSelection();
  const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;

  if (!range || !cell.contains(range.commonAncestorContainer)) {
    cell.insertAdjacentHTML('beforeend', safeHtml);
    return;
  }

  range.deleteContents();
  const fragment = range.createContextualFragment(safeHtml);
  const lastNode = fragment.lastChild;
  range.insertNode(fragment);

  if (lastNode && selection) {
    const nextRange = document.createRange();
    nextRange.setStartAfter(lastNode);
    nextRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nextRange);
  }
}

/**
 * @typedef {object} TableConfig
 * @description Tool's config from Editor
 * @property {boolean} withHeadings — Uses the first line as headings
 * @property {string[][]} withHeadings — two-dimensional array with table contents
 */

/**
 * @typedef {object} TableData - object with the data transferred to form a table
 * @property {number} rows - number of rows in the table
 * @property {number} cols - number of columns in the table
 */


/**
 * Generates and manages table contents.
 */
export default class Table {
  /**
   * Creates
   *
   * @constructor
   * @param {boolean} readOnly - read-only mode flag
   * @param {object} api - Editor.js API
   * @param {TableData} data - Editor.js API
   * @param {TableConfig} config - Editor.js API
   */
  constructor(readOnly, api, data, config) {
    this.readOnly = readOnly;
    this.api = api;
    this.data = data;
    this.config = config;

    /**
     * DOM nodes
     */
    this.wrapper = null;
    this.table = null;
    this.copyHighlightTimer = null;

    /**
     * Toolbox for managing of columns
     */
    this.toolboxColumn = this.createColumnToolbox();
    this.toolboxRow = this.createRowToolbox();

    /**
     * Create table and wrapper elements
     */
    this.createTableWrapper();

    // Current hovered row index
    this.hoveredRow = 0;

    // Current hovered column index
    this.hoveredColumn = 0;

    // Index of last selected row via toolbox
    this.selectedRow = 0;

    // Index of last selected column via toolbox
    this.selectedColumn = 0;

    // Additional settings for the table
    this.tunes = {
      withHeadings: false
    };

    /**
     * Resize table to match config/data size
     */
    this.resize();

    /**
     * Fill the table with data
     */
    this.fill();

    /**
     * The cell in which the focus is currently located, if 0 and 0 then there is no focus
     * Uses to switch between cells with buttons
     */
    this.focusedCell = {
      row: 0,
      column: 0
    };

    this.lastFocusedCellEl = null;

    /**
     * When user drags text/images within the table cell, the browser emits a drop event
     * that can bubble to Editor.js and create new blocks outside the table.
     * Track internal drags so we can swallow propagation inside the table while
     * keeping default contenteditable behavior (move/copy within cell).
     */
    this.internalDragActive = false;

    /**
     * Global click listener allows to delegate clicks on some elements
     */
    this.documentClicked = (event) => {
      const clickedInsideTable = event.target.closest(`.${CSS.table}`) !== null;
      const outsideTableClicked = event.target.closest(`.${CSS.wrapper}`) === null;
      const clickedOutsideToolboxes = clickedInsideTable || outsideTableClicked;

      if (clickedOutsideToolboxes) {
        this.hideToolboxes();
      }

      const clickedOnAddRowButton = event.target.closest(`.${CSS.addRow}`);
      const clickedOnAddColumnButton = event.target.closest(`.${CSS.addColumn}`);

      /**
       * Also, check if clicked in current table, not other (because documentClicked bound to the whole document)
       */
      if (clickedOnAddRowButton && clickedOnAddRowButton.parentNode === this.wrapper) {
        this.addRow(undefined, true);
        this.hideToolboxes();
      } else if (clickedOnAddColumnButton && clickedOnAddColumnButton.parentNode === this.wrapper) {
        this.addColumn(undefined, true);
        this.hideToolboxes();
      }
    };

    this.handleImageClick = (event) => {
      const image = event.target.closest(`.${CSS.cell} img[src]`);

      if (!image || !this.table.contains(image)) {
        return;
      }

      const src = image.getAttribute('src');

      if (!src || typeof window === 'undefined' || typeof window.open !== 'function') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      window.open(src, '_blank', 'noopener,noreferrer');
    };

    this.table.addEventListener('click', this.handleImageClick);

    if (!this.readOnly) {
      this.bindEvents();
    }
  }

  /**
   * Returns the rendered table wrapper
   *
   * @returns {Element}
   */
  getWrapper() {
    return this.wrapper;
  }

  /**
   * Hangs the necessary handlers to events
   */
  bindEvents() {
    // set the listener to close toolboxes when click outside
    document.addEventListener('click', this.documentClicked);

    // Update toolboxes position depending on the mouse movements
    this.table.addEventListener('mousemove', throttled(150, (event) => this.onMouseMoveInTable(event)), { passive: true });

    // Controls some of the keyboard buttons inside the table
    this.table.onkeypress = (event) => this.onKeyPressListener(event);

    // Tab is executed by default before keypress, so it must be intercepted on keydown
    this.table.addEventListener('keydown', (event) => this.onKeyDownListener(event));

    // Determine the position of the cell in focus
    this.table.addEventListener('focusin', event => this.focusInTableListener(event));

    /**
     * Intercept image paste/drop inside table cells and assetize via uploader.
     * This prevents massive data: payloads from being stored in cell HTML.
     */
    this.table.addEventListener('paste', (event) => {
      void this.onPasteInCell(event);
    }, true);

    this.table.addEventListener('dragstart', (event) => this.onDragStartInTable(event), true);
    this.table.addEventListener('dragend', () => {
      this.internalDragActive = false;
    }, true);

    this.table.addEventListener('dragover', (event) => this.onDragOverInCell(event), true);
    this.table.addEventListener('drop', (event) => {
      void this.onDropInCell(event);
    }, true);
  }

  swallowEditorDragEvent(event) {
    if (!event) {
      return;
    }
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
  }

  onDragStartInTable(event) {
    const cell = event && event.target && event.target.closest ? event.target.closest(`.${CSS.cell}`) : null;
    if (!cell || !this.table || !this.table.contains(cell)) {
      return;
    }

    this.internalDragActive = true;
  }

  /**
   * @param {ClipboardEvent} event
   */
  async onPasteInCell(event) {
    if (!event || !event.clipboardData) {
      return;
    }

    const cell = event.target && event.target.closest ? event.target.closest(`.${CSS.cell}`) : null;
    if (!cell || !this.table || !this.table.contains(cell)) {
      return;
    }

    const uploader = getUploader(this.config);
    const clipboardFiles = extractImageFilesFromDataTransfer(event.clipboardData);

    if (clipboardFiles.length > 0 && typeof uploader.uploadByFile === 'function') {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }

      for (const file of clipboardFiles) {
        try {
          const result = await uploader.uploadByFile(file);
          const url = getUploadedUrl(result);
          if (url) {
            insertHtmlAtSelection(cell, `<img src="${url}" alt="">`);
          }
        } catch (e) {
          // ignore single upload failure; allow user to continue editing
        }
      }

      this.syncCellMediaState(cell);
      return;
    }

    /**
     * If HTML paste contains images (data:/blob:/file:/http), allow the browser to paste
     * and then rewrite the <img src> via assetization on the next tick.
     */
    const html = event.clipboardData.getData ? event.clipboardData.getData('text/html') : '';
    if (html && /<img\b/i.test(html) && (typeof uploader.uploadByFile === 'function' || typeof uploader.uploadByUrl === 'function' || typeof uploader.importLocalSrc === 'function')) {
      window.setTimeout(() => {
        void assetizeTableCellElement(cell, {
          uploadByFile: uploader.uploadByFile,
          uploadByUrl: uploader.uploadByUrl,
          importLocalSrc: uploader.importLocalSrc,
          clipboardFiles
        }).then(() => {
          this.syncCellMediaState(cell);
        }).catch(() => {
          // ignore
        });
      }, 0);
    }
  }

  onDragOverInCell(event) {
    const dt = event && event.dataTransfer;
    const cell = event && event.target && event.target.closest ? event.target.closest(`.${CSS.cell}`) : null;
    if (!dt || !cell || !this.table || !this.table.contains(cell)) {
      return;
    }

    // Never let Editor.js see dragover coming from inside the table.
    this.swallowEditorDragEvent(event);

    /**
     * Important: browsers only allow dropping when dragover prevents default.
     * For internal drags (text/image moved within the table), we want native
     * contenteditable drop behavior inside the cell, but still must:
     * - preventDefault() on dragover to "activate" the drop target
     * - stopPropagation() so Editor.js won't create blocks outside
     */
    if (this.internalDragActive) {
      event.preventDefault();
      try {
        dt.dropEffect = 'move';
      } catch (_) {}
      try {
        if (typeof cell.focus === 'function') {
          cell.focus();
        }
      } catch (_) {}
      return;
    }

    const types = dt.types ? Array.from(dt.types) : [];
    const hasFiles = types.includes('Files') || (dt.files && dt.files.length > 0);

    if (hasFiles) {
      event.preventDefault();
      try {
        dt.dropEffect = 'copy';
      } catch (_) {}
    }
  }

  /**
   * @param {DragEvent} event
   */
  async onDropInCell(event) {
    const dt = event && event.dataTransfer;
    const cell = event && event.target && event.target.closest ? event.target.closest(`.${CSS.cell}`) : null;
    if (!dt || !cell || !this.table || !this.table.contains(cell)) {
      return;
    }

    // Always swallow so Editor.js won't insert a new block outside the table.
    this.swallowEditorDragEvent(event);

    const uploader = getUploader(this.config);
    const files = extractImageFilesFromDataTransfer(dt);

    // Internal drag within the table: keep native contenteditable drop behavior.
    // Do NOT attempt uploadByUrl/uploadByFile based on DataTransfer text/html.
    if (this.internalDragActive) {
      this.internalDragActive = false;
      return;
    }

    if (files.length > 0 && typeof uploader.uploadByFile === 'function') {
      event.preventDefault();

      for (const file of files) {
        try {
          const result = await uploader.uploadByFile(file);
          const url = getUploadedUrl(result);
          if (url) {
            insertHtmlAtSelection(cell, `<img src="${url}" alt="">`);
          }
        } catch (e) {
          // ignore
        }
      }

      this.syncCellMediaState(cell);
      return;
    }

    const uriList = (typeof dt.getData === 'function' ? dt.getData('text/uri-list') : '') || '';
    const text = (typeof dt.getData === 'function' ? dt.getData('text/plain') : '') || '';
    const candidate = String(uriList || text || '').trim();

    if (candidate && /^https?:\/\//i.test(candidate) && typeof uploader.uploadByUrl === 'function') {
      event.preventDefault();

      try {
        const result = await uploader.uploadByUrl(candidate);
        const url = getUploadedUrl(result);
        if (url) {
          insertHtmlAtSelection(cell, `<img src="${url}" alt="">`);
          this.syncCellMediaState(cell);
        }
      } catch (_) {
        // ignore
      }
    }
  }

  /**
   * Configures and creates the toolbox for manipulating with columns
   *
   * @returns {Toolbox}
   */
  createColumnToolbox() {
    return new Toolbox({
      api: this.api,
      cssModifier: 'column',
      items: [
        {
          label: this.api.i18n.t('Add column to left'),
          icon: IconDirectionLeftDown,
          hideIf: () => {
            return this.numberOfColumns === this.config.maxcols
          },
          onClick: () => {
            this.addColumn(this.selectedColumn, true);
            this.hideToolboxes();
          }
        },
        {
          label: this.api.i18n.t('Add column to right'),
          icon: IconDirectionRightDown,
          hideIf: () => {
            return this.numberOfColumns === this.config.maxcols
          },
          onClick: () => {
            this.addColumn(this.selectedColumn + 1, true);
            this.hideToolboxes();
          }
        },
        {
          label: this.api.i18n.t('Delete column'),
          icon: IconCross,
          hideIf: () => {
            return this.numberOfColumns === 1;
          },
          confirmationRequired: true,
          onClick: () => {
            this.deleteColumn(this.selectedColumn);
            this.hideToolboxes();
          }
        }
      ],
      onOpen: () => {
        this.selectColumn(this.hoveredColumn);
        this.hideRowToolbox();
      },
      onClose: () => {
        this.unselectColumn();
      }
    });
  }

  /**
   * Configures and creates the toolbox for manipulating with rows
   *
   * @returns {Toolbox}
   */
  createRowToolbox() {
    return new Toolbox({
      api: this.api,
      cssModifier: 'row',
      items: [
        {
          label: this.api.i18n.t('Add row above'),
          icon: IconDirectionUpRight,
          hideIf: () => {
            return this.numberOfRows === this.config.maxrows
          },
          onClick: () => {
            this.addRow(this.selectedRow, true);
            this.hideToolboxes();
          }
        },
        {
          label: this.api.i18n.t('Add row below'),
          icon: IconDirectionDownRight,
          hideIf: () => {
            return this.numberOfRows === this.config.maxrows
          },
          onClick: () => {
            this.addRow(this.selectedRow + 1, true);
            this.hideToolboxes();
          }
        },
        {
          label: this.api.i18n.t('Delete row'),
          icon: IconCross,
          hideIf: () => {
            return this.numberOfRows === 1;
          },
          confirmationRequired: true,
          onClick: () => {
            this.deleteRow(this.selectedRow);
            this.hideToolboxes();
          }
        }
      ],
      onOpen: () => {
        this.selectRow(this.hoveredRow);
        this.hideColumnToolbox();
      },
      onClose: () => {
        this.unselectRow();
      }
    });
  }

  /**
   * When you press enter it moves the cursor down to the next row
   * or creates it if the click occurred on the last one
   */
  moveCursorToNextRow() {
    if (this.focusedCell.row !== this.numberOfRows) {
      this.focusedCell.row += 1;
      this.focusCell(this.focusedCell);
    } else {
      this.addRow();
      this.focusedCell.row += 1;
      this.focusCell(this.focusedCell);
      this.updateToolboxesPosition(0, 0);
    }
  }

  /**
   * Get table cell by row and col index
   *
   * @param {number} row - cell row coordinate
   * @param {number} column - cell column coordinate
   * @returns {HTMLElement}
   */
  getCell(row, column) {
    return this.table.querySelectorAll(`.${CSS.row}:nth-child(${row}) .${CSS.cell}`)[column - 1];
  }

  /**
   * Get table row by index
   *
   * @param {number} row - row coordinate
   * @returns {HTMLElement}
   */
  getRow(row) {
    return this.table.querySelector(`.${CSS.row}:nth-child(${row})`);
  }

  /**
   * The parent of the cell which is the row
   *
   * @param {HTMLElement} cell - cell element
   * @returns {HTMLElement}
   */
  getRowByCell(cell) {
    return cell.parentElement;
  }

  /**
   * Ger row's first cell
   *
   * @param {Element} row - row to find its first cell
   * @returns {Element}
   */
  getRowFirstCell(row) {
    return row.querySelector(`.${CSS.cell}:first-child`);
  }

  /**
   * Set the sell's content by row and column numbers
   *
   * @param {number} row - cell row coordinate
   * @param {number} column - cell column coordinate
   * @param {string} content - cell HTML content
   */
  setCellContent(row, column, content) {
    const cell = this.getCell(row, column);

    cell.innerHTML = normalizeTableCellHtml(content);
    this.syncCellMediaState(cell);
  }

  /**
   * Applies a stable media state to cells that contain images.
   *
   * @param {HTMLElement} cell - cell element
   */
  syncCellMediaState(cell) {
    const hasImage = cell.querySelector('img') !== null;

    cell.classList.toggle(CSS.cellMedia, hasImage);
  }

  /**
   * Add column in table on index place
   * Add cells in each row
   *
   * @param {number} columnIndex - number in the array of columns, where new column to insert, -1 if insert at the end
   * @param {boolean} [setFocus] - pass true to focus the first cell
   */
  addColumn(columnIndex = -1, setFocus = false) {
    let numberOfColumns = this.numberOfColumns;
     /**
      * Check if the number of columns has reached the maximum allowed columns specified in the configuration,
      * and if so, exit the function to prevent adding more columns beyond the limit.
      */
    if (this.config && this.config.maxcols && this.numberOfColumns >= this.config.maxcols) {
      return;
  }

    /**
     * Iterate all rows and add a new cell to them for creating a column
     */
    for (let rowIndex = 1; rowIndex <= this.numberOfRows; rowIndex++) {
      let cell;
      const cellElem = this.createCell();

      if (columnIndex > 0 && columnIndex <= numberOfColumns) {
        cell = this.getCell(rowIndex, columnIndex);

        $.insertBefore(cellElem, cell);
      } else {
        cell = this.getRow(rowIndex).appendChild(cellElem);
      }

      /**
       * Autofocus first cell
       */
      if (rowIndex === 1) {
        const firstCell = this.getCell(rowIndex, columnIndex > 0 ? columnIndex : numberOfColumns + 1);

        if (firstCell && setFocus) {
          $.focus(firstCell);
        }
      }
    }

    const addColButton = this.wrapper.querySelector(`.${CSS.addColumn}`);
    if (this.config?.maxcols && this.numberOfColumns > this.config.maxcols - 1 && addColButton ){
      addColButton.classList.add(CSS.addColumnDisabled);
    }
    this.addHeadingAttrToFirstRow();
  };

  /**
   * Add row in table on index place
   *
   * @param {number} index - number in the array of rows, where new column to insert, -1 if insert at the end
   * @param {boolean} [setFocus] - pass true to focus the inserted row
   * @returns {HTMLElement} row
   */
  addRow(index = -1, setFocus = false) {
    let insertedRow;
    let rowElem = $.make('div', CSS.row);

    if (this.tunes.withHeadings) {
      this.removeHeadingAttrFromFirstRow();
    }

    /**
     * We remember the number of columns, because it is calculated
     * by the number of cells in the first row
     * It is necessary that the first line is filled in correctly
     */
    let numberOfColumns = this.numberOfColumns;
     /**
      * Check if the number of rows has reached the maximum allowed rows specified in the configuration,
      * and if so, exit the function to prevent adding more columns beyond the limit.
      */  
    if (this.config && this.config.maxrows && this.numberOfRows >= this.config.maxrows && addRowButton) {
      return;
    }

    if (index > 0 && index <= this.numberOfRows) {
      let row = this.getRow(index);

      insertedRow = $.insertBefore(rowElem, row);
    } else {
      insertedRow = this.table.appendChild(rowElem);
    }

    this.fillRow(insertedRow, numberOfColumns);

    if (this.tunes.withHeadings) {
      this.addHeadingAttrToFirstRow();
    }

    const insertedRowFirstCell = this.getRowFirstCell(insertedRow);

    if (insertedRowFirstCell && setFocus) {
      $.focus(insertedRowFirstCell);
    }

    const addRowButton = this.wrapper.querySelector(`.${CSS.addRow}`);
    if (this.config && this.config.maxrows && this.numberOfRows >= this.config.maxrows && addRowButton) {
      addRowButton.classList.add(CSS.addRowDisabled);
    }
    return insertedRow;
  };

  /**
   * Delete a column by index
   *
   * @param {number} index
   */
  deleteColumn(index) {
    for (let i = 1; i <= this.numberOfRows; i++) {
      const cell = this.getCell(i, index);

      if (!cell) {
        return;
      }

      cell.remove();
    }
    const addColButton = this.wrapper.querySelector(`.${CSS.addColumn}`);
    if (addColButton) {
      addColButton.classList.remove(CSS.addColumnDisabled);
    }
  }

  /**
   * Delete a row by index
   *
   * @param {number} index
   */
  deleteRow(index) {
    this.getRow(index).remove();
    const addRowButton = this.wrapper.querySelector(`.${CSS.addRow}`);
    if (addRowButton) {
      addRowButton.classList.remove(CSS.addRowDisabled);
    }

    this.addHeadingAttrToFirstRow();
  }

  /**
   * Create a wrapper containing a table, toolboxes
   * and buttons for adding rows and columns
   *
   * @returns {HTMLElement} wrapper - where all buttons for a table and the table itself will be
   */
  createTableWrapper() {
    this.wrapper = $.make('div', CSS.wrapper);
    this.table = $.make('div', CSS.table);

    if (this.readOnly) {
      this.wrapper.classList.add(CSS.wrapperReadOnly);
    }

    this.wrapper.appendChild(this.toolboxRow.element);
    this.wrapper.appendChild(this.toolboxColumn.element);
    this.wrapper.appendChild(this.table);

    if (!this.readOnly) {
      const addColumnButton = $.make('div', CSS.addColumn, {
        innerHTML: IconPlus
      });
      const addRowButton = $.make('div', CSS.addRow, {
        innerHTML: IconPlus
      });

      this.wrapper.appendChild(addColumnButton);
      this.wrapper.appendChild(addRowButton);
    }

    this.createCopyButton();
  }

  /**
   * Create "COPY" button overlay (doesn't affect layout height)
   */
  createCopyButton() {
    const btn = $.make('button', CSS.copyButton, {
      type: 'button',
      innerHTML: IconClipboard,
      ariaLabel: 'Copy table'
    });
    btn.dataset.mutationFree = 'true';

    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.copyTableToClipboard(btn);
    });

    this.wrapper.appendChild(btn);
  }

  /**
   * Copy table to clipboard in Excel-friendly format:
   * - text/plain: TSV
   * - text/html: <table>
   *
   * @param {HTMLButtonElement} btn
   */
  async copyTableToClipboard(btn) {
    const matrix = this.getDataForCopy();
    const tsv = this.toTSV(matrix);
    const html = this.toHTMLTable(matrix, this.table.classList.contains(CSS.withHeadings));

    try {
      await this.writeToClipboard({ tsv, html });
      this.flashCopied(btn);
    } catch (e) {
      /**
       * Fallback for non-secure contexts (clipboard API restrictions)
       */
      this.execCopyFallback(tsv);
      this.flashCopied(btn);
    }
  }

  /**
   * Get full table content (including empty rows) as plain text matrix.
   *
   * @returns {string[][]}
   */
  getDataForCopy() {
    const rows = [];

    for (let rowIndex = 1; rowIndex <= this.numberOfRows; rowIndex++) {
      const row = this.getRow(rowIndex);
      const cells = Array.from(row.querySelectorAll(`.${CSS.cell}`));

      rows.push(cells.map((cell) => this.extractCellPlainText(cell)));
    }

    return rows;
  }

  /**
   * @param {HTMLElement} cell
   * @returns {string}
   */
  extractCellPlainText(cell) {
    const text = (cell.innerText ?? cell.textContent ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    return text.trim();
  }

  /**
   * Convert matrix to TSV (Excel-friendly).
   *
   * @param {string[][]} matrix
   * @returns {string}
   */
  toTSV(matrix) {
    const escape = (value) => {
      const v = (value ?? '')
        .toString()
        /**
         * Keep TSV resilient for parsers that don't honor quoting.
         * Newlines/tabs inside a cell can break row/column structure when pasting to Excel.
         */
        .replace(/\t/g, ' ')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n/g, ' ');
      const needsQuotes = /[\t\n"]/.test(v);

      if (!needsQuotes) {
        return v;
      }

      return `"${v.replace(/"/g, '""')}"`;
    };

    return matrix
      .map((row) => row.map(escape).join('\t'))
      .join('\r\n');
  }

  /**
   * Convert matrix to an HTML table string for rich paste.
   *
   * @param {string[][]} matrix
   * @param {boolean} withHeadings
   * @returns {string}
   */
  toHTMLTable(matrix, withHeadings) {
    const table = document.createElement('table');
    const tbody = document.createElement('tbody');

    matrix.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      const cellTag = withHeadings && rowIndex === 0 ? 'th' : 'td';

      row.forEach((value) => {
        const td = document.createElement(cellTag);
        td.textContent = value ?? '';
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    return table.outerHTML;
  }

  /**
   * @param {{tsv: string, html: string}} payload
   */
  async writeToClipboard(payload) {
    const { tsv, html } = payload;

    if (navigator.clipboard?.write && window.ClipboardItem) {
      const item = new ClipboardItem({
        'text/plain': new Blob([tsv], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      });

      await navigator.clipboard.write([item]);
      return;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(tsv);
      return;
    }

    throw new Error('Clipboard API not available');
  }

  /**
   * Legacy fallback for clipboard write in non-secure contexts.
   *
   * @param {string} text
   */
  execCopyFallback(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';

    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  /**
   * @param {HTMLButtonElement} btn
   */
  flashCopied(btn) {
    const original = btn.innerHTML;
    btn.innerHTML = ICON_CHECK;
    btn.classList.add(CSS.copyButtonCopied);
    this.flashCopyHighlight();

    window.setTimeout(() => {
      btn.innerHTML = original || IconClipboard;
      btn.classList.remove(CSS.copyButtonCopied);
    }, 900);
  }

  flashCopyHighlight() {
    if (!this.wrapper) {
      return;
    }

    if (this.copyHighlightTimer) {
      window.clearTimeout(this.copyHighlightTimer);
      this.copyHighlightTimer = null;
    }

    this.wrapper.classList.remove(CSS.copyHighlight);

    window.requestAnimationFrame(() => {
      this.wrapper.classList.add(CSS.copyHighlight);

      this.copyHighlightTimer = window.setTimeout(() => {
        this.wrapper.classList.remove(CSS.copyHighlight);
        this.copyHighlightTimer = null;
      }, 1500);
    });
  }

  /**
   * Returns the size of the table based on initial data or config "size" property
   *
   * @return {{rows: number, cols: number}} - number of cols and rows
   */
  computeInitialSize() {
    const content = this.data && this.data.content;
    const isValidArray = Array.isArray(content);
    const isNotEmptyArray = isValidArray ? content.length : false;
    const contentRows = isValidArray ? content.length : undefined;
    const contentCols = isNotEmptyArray ? content[0].length : undefined;
    const parsedRows = Number.parseInt(this.config && this.config.rows);
    const parsedCols = Number.parseInt(this.config && this.config.cols);

    /**
     * Value of config have to be positive number
     */
    const configRows = !isNaN(parsedRows) && parsedRows > 0 ? parsedRows : undefined;
    const configCols = !isNaN(parsedCols) && parsedCols > 0 ? parsedCols : undefined;
    const defaultRows = 2;
    const defaultCols = 2;
    const rows = contentRows || configRows || defaultRows;
    const cols = contentCols || configCols || defaultCols;

    return {
      rows: rows,
      cols: cols
    };
  }

  /**
   * Resize table to match config size or transmitted data size
   *
   * @return {{rows: number, cols: number}} - number of cols and rows
   */
  resize() {
    const { rows, cols } = this.computeInitialSize();

    for (let i = 0; i < rows; i++) {
      this.addRow();
    }

    for (let i = 0; i < cols; i++) {
      this.addColumn();
    }
  }

  /**
   * Fills the table with data passed to the constructor
   *
   * @returns {void}
   */
  fill() {
    const data = this.data;

    if (data && data.content) {
      for (let i = 0; i < data.content.length; i++) {
        for (let j = 0; j < data.content[i].length; j++) {
          this.setCellContent(i + 1, j + 1, data.content[i][j]);
        }
      }
    }
  }

  /**
   * Fills a row with cells
   *
   * @param {HTMLElement} row - row to fill
   * @param {number} numberOfColumns - how many cells should be in a row
   */
  fillRow(row, numberOfColumns) {
    for (let i = 1; i <= numberOfColumns; i++) {
      const newCell = this.createCell();

      row.appendChild(newCell);
    }
  }

  /**
   * Creating a cell element
   *
   * @return {Element}
   */
  createCell() {
    return $.make('div', CSS.cell, {
      contentEditable: !this.readOnly
    });
  }

  /**
   * Get number of rows in the table
   */
  get numberOfRows() {
    return this.table.childElementCount;
  }

  /**
   * Get number of columns in the table
   */
  get numberOfColumns() {
    if (this.numberOfRows) {
      return this.table.querySelectorAll(`.${CSS.row}:first-child .${CSS.cell}`).length;
    }

    return 0;
  }

  /**
   * Is the column toolbox menu displayed or not
   *
   * @returns {boolean}
   */
  get isColumnMenuShowing() {
    return this.selectedColumn !== 0;
  }

  /**
   * Is the row toolbox menu displayed or not
   *
   * @returns {boolean}
   */
  get isRowMenuShowing() {
    return this.selectedRow !== 0;
  }

  /**
   * Recalculate position of toolbox icons
   *
   * @param {Event} event - mouse move event
   */
  onMouseMoveInTable(event) {
    const { row, column } = this.getHoveredCell(event);

    this.hoveredColumn = column;
    this.hoveredRow = row;

    this.updateToolboxesPosition();
  }

  /**
   * Prevents default Enter behaviors
   * Adds Shift+Enter processing
   *
   * @param {KeyboardEvent} event - keypress event
   */
  onKeyPressListener(event) {
    if (event.key === 'Enter') {
      if (event.shiftKey) {
        return true;
      }

      this.moveCursorToNextRow();
    }

    return event.key !== 'Enter';
  };

  /**
   * Prevents tab keydown event from bubbling
   * so that it only works inside the table
   *
   * @param {KeyboardEvent} event - keydown event
   */
  onKeyDownListener(event) {
    if (event.key === 'Tab') {
      event.stopPropagation();
    }
  }

  /**
   * Set the coordinates of the cell that the focus has moved to
   *
   * @param {FocusEvent} event - focusin event
   */
  focusInTableListener(event) {
    const cell = event.target;
    const row = this.getRowByCell(cell);

    if (this.lastFocusedCellEl && this.lastFocusedCellEl.classList) {
      this.lastFocusedCellEl.classList.remove(CSS.cellFocus);
    }

    if (cell && cell.classList) {
      cell.classList.add(CSS.cellFocus);
      this.lastFocusedCellEl = cell;
    } else {
      this.lastFocusedCellEl = null;
    }

    this.focusedCell = {
      row: Array.from(this.table.querySelectorAll(`.${CSS.row}`)).indexOf(row) + 1,
      column: Array.from(row.querySelectorAll(`.${CSS.cell}`)).indexOf(cell) + 1
    };
  }

  /**
   * Unselect row/column
   * Close toolbox menu
   * Hide toolboxes
   *
   * @returns {void}
   */
  hideToolboxes() {
    this.hideRowToolbox();
    this.hideColumnToolbox();
    this.updateToolboxesPosition();
  }

  /**
   * Unselect row, close toolbox
   *
   * @returns {void}
   */
  hideRowToolbox() {
    this.unselectRow();
    this.toolboxRow.hide();
  }
  /**
   * Unselect column, close toolbox
   *
   * @returns {void}
   */
  hideColumnToolbox() {
    this.unselectColumn();

    this.toolboxColumn.hide();
  }

  /**
   * Set the cursor focus to the focused cell
   *
   * @returns {void}
   */
  focusCell() {
    this.focusedCellElem.focus();
  }

  /**
   * Get current focused element
   *
   * @returns {HTMLElement} - focused cell
   */
  get focusedCellElem() {
    const { row, column } = this.focusedCell;

    return this.getCell(row, column);
  }

  /**
   * Update toolboxes position
   *
   * @param {number} row - hovered row
   * @param {number} column - hovered column
   */
  updateToolboxesPosition(row = this.hoveredRow, column = this.hoveredColumn) {
    if (!this.isColumnMenuShowing) {
      if (column > 0 && column <= this.numberOfColumns) { // not sure this statement is needed. Maybe it should be fixed in getHoveredCell()
        this.toolboxColumn.show(() => {
          return {
            left: `calc((100% - var(--cell-size)) / (${this.numberOfColumns} * 2) * (1 + (${column} - 1) * 2))`
          };
        });
      }
    }

    if (!this.isRowMenuShowing) {
      if (row > 0 && row <= this.numberOfRows) { // not sure this statement is needed. Maybe it should be fixed in getHoveredCell()
        this.toolboxRow.show(() => {
          const hoveredRowElement = this.getRow(row);
          const { fromTopBorder } = $.getRelativeCoordsOfTwoElems(this.table, hoveredRowElement);
          const { height } = hoveredRowElement.getBoundingClientRect();

          return {
            top: `${Math.ceil(fromTopBorder + height / 2)}px`
          };
        });
      }
    }
  }

  /**
   * Makes the first row headings
   *
   * @param {boolean} withHeadings - use headings row or not
   */
  setHeadingsSetting(withHeadings) {
    this.tunes.withHeadings = withHeadings;

    if (withHeadings) {
      this.table.classList.add(CSS.withHeadings);
      this.addHeadingAttrToFirstRow();
    } else {
      this.table.classList.remove(CSS.withHeadings);
      this.removeHeadingAttrFromFirstRow();
    }
  }

  /**
   * Adds an attribute for displaying the placeholder in the cell
   */
  addHeadingAttrToFirstRow() {
    for (let cellIndex = 1; cellIndex <= this.numberOfColumns; cellIndex++) {
      let cell = this.getCell(1, cellIndex);

      if (cell) {
        cell.setAttribute('heading', this.api.i18n.t('Heading'));
      }
    }
  }

  /**
   * Removes an attribute for displaying the placeholder in the cell
   */
  removeHeadingAttrFromFirstRow() {
    for (let cellIndex = 1; cellIndex <= this.numberOfColumns; cellIndex++) {
      let cell = this.getCell(1, cellIndex);

      if (cell) {
        cell.removeAttribute('heading');
      }
    }
  }

  /**
   * Add effect of a selected row
   *
   * @param {number} index
   */
  selectRow(index) {
    const row = this.getRow(index);

    if (row) {
      this.selectedRow = index;
      row.classList.add(CSS.rowSelected);
    }
  }

  /**
   * Remove effect of a selected row
   */
  unselectRow() {
    if (this.selectedRow <= 0) {
      return;
    }

    const row = this.table.querySelector(`.${CSS.rowSelected}`);

    if (row) {
      row.classList.remove(CSS.rowSelected);
    }

    this.selectedRow = 0;
  }

  /**
   * Add effect of a selected column
   *
   * @param {number} index
   */
  selectColumn(index) {
    for (let i = 1; i <= this.numberOfRows; i++) {
      const cell = this.getCell(i, index);

      if (cell) {
        cell.classList.add(CSS.cellSelected);
      }
    }

    this.selectedColumn = index;
  }

  /**
   * Remove effect of a selected column
   */
  unselectColumn() {
    if (this.selectedColumn <= 0) {
      return;
    }

    let cells = this.table.querySelectorAll(`.${CSS.cellSelected}`);

    Array.from(cells).forEach(column => {
      column.classList.remove(CSS.cellSelected);
    });

    this.selectedColumn = 0;
  }

  /**
   * Calculates the row and column that the cursor is currently hovering over
   * The search was optimized from O(n) to O (log n) via bin search to reduce the number of calculations
   *
   * @param {Event} event - mousemove event
   * @returns hovered cell coordinates as an integer row and column
   */
  getHoveredCell(event) {
    let hoveredRow = this.hoveredRow;
    let hoveredColumn = this.hoveredColumn;
    const { width, height, x, y } = $.getCursorPositionRelativeToElement(this.table, event);

    // Looking for hovered column
    if (x >= 0) {
      hoveredColumn = this.binSearch(
        this.numberOfColumns,
        (mid) => this.getCell(1, mid),
        ({ fromLeftBorder }) => x < fromLeftBorder,
        ({ fromRightBorder }) => x > (width - fromRightBorder)
      );
    }

    // Looking for hovered row
    if (y >= 0) {
      hoveredRow = this.binSearch(
        this.numberOfRows,
        (mid) => this.getCell(mid, 1),
        ({ fromTopBorder }) => y < fromTopBorder,
        ({ fromBottomBorder }) => y > (height - fromBottomBorder)
      );
    }

    return {
      row: hoveredRow || this.hoveredRow,
      column: hoveredColumn || this.hoveredColumn
    };
  }

  /**
   * Looks for the index of the cell the mouse is hovering over.
   * Cells can be represented as ordered intervals with left and
   * right (upper and lower for rows) borders inside the table, if the mouse enters it, then this is our index
   *
   * @param {number} numberOfCells - upper bound of binary search
   * @param {function} getCell - function to take the currently viewed cell
   * @param {function} beforeTheLeftBorder - determines the cursor position, to the left of the cell or not
   * @param {function} afterTheRightBorder - determines the cursor position, to the right of the cell or not
   * @returns {number}
   */
  binSearch(numberOfCells, getCell, beforeTheLeftBorder, afterTheRightBorder) {
    let leftBorder = 0;
    let rightBorder = numberOfCells + 1;
    let totalIterations = 0;
    let mid;

    while (leftBorder < rightBorder - 1 && totalIterations < 10) {
      mid = Math.ceil((leftBorder + rightBorder) / 2);

      const cell = getCell(mid);
      const relativeCoords = $.getRelativeCoordsOfTwoElems(this.table, cell);

      if (beforeTheLeftBorder(relativeCoords)) {
        rightBorder = mid;
      } else if (afterTheRightBorder(relativeCoords)) {
        leftBorder = mid;
      } else {
        break;
      }

      totalIterations++;
    }

    return mid;
  }

  /**
   * Collects data from cells into a two-dimensional array
   *
   * @returns {string[][]}
   */
  getData() {
    const data = [];

    for (let i = 1; i <= this.numberOfRows; i++) {
      const row = this.table.querySelector(`.${CSS.row}:nth-child(${i})`);
      const cells = Array.from(row.querySelectorAll(`.${CSS.cell}`));
      const isEmptyRow = cells.every(cell => !cell.textContent.trim());

      if (isEmptyRow) {
        continue;
      }

      data.push(cells.map(cell => cell.innerHTML));
    }

    return data;
  }

  /**
   * Remove listeners on the document
   */
  destroy() {
    document.removeEventListener('click', this.documentClicked);
    this.table.removeEventListener('click', this.handleImageClick);
    if (this.lastFocusedCellEl && this.lastFocusedCellEl.classList) {
      this.lastFocusedCellEl.classList.remove(CSS.cellFocus);
    }
  }
}