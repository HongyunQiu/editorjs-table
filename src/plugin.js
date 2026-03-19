import Table from './table';
import * as $ from './utils/dom';
import { buildPastedTableContent } from './pasteImageAssetization.mjs';

import { IconTable, IconTableWithHeadings, IconTableWithoutHeadings, IconStretch, IconCollapse } from '@codexteam/icons';
/**
 * @typedef {object} TableData - configuration that the user can set for the table
 * @property {number} rows - number of rows in the table
 * @property {number} cols - number of columns in the table
 */
/**
 * @typedef {object} Tune - setting for the table
 * @property {string} name - tune name
 * @property {HTMLElement} icon - icon for the tune
 * @property {boolean} isActive - default state of the tune
 * @property {void} setTune - set tune state to the table data
 */
/**
 * @typedef {object} TableConfig - object with the data transferred to form a table
 * @property {boolean} withHeading - setting to use cells of the first row as headings
 * @property {string[][]} content - two-dimensional array which contains table content
 */
/**
 * @typedef {object} TableConstructor
 * @property {TableConfig} data — previously saved data
 * @property {TableConfig} config - user config for Tool
 * @property {object} api - Editor.js API
 * @property {boolean} readOnly - read-only mode flag
 */
/**
 * @typedef {import('@editorjs/editorjs').PasteEvent} PasteEvent
 */


/**
 * Table block for Editor.js
 */
export default class TableBlock {
  /**
   * Notify core that read-only mode is supported
   *
   * @returns {boolean}
   */
  static get isReadOnlySupported() {
    return true;
  }

  /**
   * Allow to press Enter inside the CodeTool textarea
   *
   * @returns {boolean}
   * @public
   */
  static get enableLineBreaks() {
    return true;
  }

  /**
   * Render plugin`s main Element and fill it with saved data
   *
   * @param {TableConstructor} init
   */
  constructor({data, config, api, readOnly, block}) {
    this.api = api;
    this.readOnly = readOnly;
    this.config = config;
    this.data = {
      withHeadings: this.getConfig('withHeadings', false, data),
      stretched: this.getConfig('stretched', false, data),
      content: data && data.content ? data.content : []
    };
    this.table = null;
    this.block = block;
  }

  /**
   * Get Tool toolbox settings
   * icon - Tool icon's SVG
   * title - title to show in toolbox
   *
   * @returns {{icon: string, title: string}}
   */
  static get toolbox() {
    return {
      icon: IconTable,
      title: 'Table'
    };
  }

  /**
   * Return Tool's view
   *
   * @returns {HTMLDivElement}
   */
  render() {
    /** creating table */
    this.table = new Table(this.readOnly, this.api, this.data, this.config);

    /** creating container around table */
    this.container = $.make('div', this.api.styles.block);
    this.container.appendChild(this.table.getWrapper());

    this.table.setHeadingsSetting(this.data.withHeadings);

    return this.container;
  }

  /**
   * Returns plugin settings
   *
   * @returns {Array}
   */
  renderSettings() {
    return [
      {
        label: this.api.i18n.t('With headings'),
        icon: IconTableWithHeadings,
        isActive: this.data.withHeadings,
        closeOnActivate: true,
        toggle: true,
        onActivate: () => {
          this.data.withHeadings = true;
          this.table.setHeadingsSetting(this.data.withHeadings);
        }
      }, {
        label: this.api.i18n.t('Without headings'),
        icon: IconTableWithoutHeadings,
        isActive: !this.data.withHeadings,
        closeOnActivate: true,
        toggle: true,
        onActivate: () => {
          this.data.withHeadings = false;
          this.table.setHeadingsSetting(this.data.withHeadings);
        }
      }, {
        label: this.data.stretched ? this.api.i18n.t('Collapse') : this.api.i18n.t('Stretch'),
        icon: this.data.stretched ? IconCollapse : IconStretch,
        closeOnActivate: true,
        toggle: true,
        onActivate: () => {
          this.data.stretched = !this.data.stretched;
          this.block.stretched = this.data.stretched;
        }
      }
    ];
  }
  /**
   * Extract table data from the view
   *
   * @returns {TableData} - saved data
   */
  save() {
    const tableContent = this.table.getData();

    const result = {
      withHeadings: this.data.withHeadings,
      stretched: this.data.stretched,
      content: tableContent
    };

    return result;
  }

  /**
   * Plugin destroyer
   *
   * @returns {void}
   */
  destroy() {
    this.table.destroy();
  }

  /**
   * A helper to get config value.
   *
   * @param {string} configName - the key to get from the config.
   * @param {any} defaultValue - default value if config doesn't have passed key
   * @param {object} savedData - previously saved data. If passed, the key will be got from there, otherwise from the config
   * @returns {any} - config value.
   */
  getConfig(configName, defaultValue = undefined, savedData = undefined) {
    const data = this.data || savedData;

    if (data) {
      return data[configName] ? data[configName] : defaultValue;
    }

    return this.config && this.config[configName] ? this.config[configName] : defaultValue;
  }

  /**
   * Table onPaste configuration
   *
   * @public
   */
  static get pasteConfig() {
    return { tags: ['TABLE', 'TR', 'TH', 'TD'] };
  }

  /**
   * Preserve inline formatting and uploaded images inside table cells
   * when Editor.js sanitizes tool output during save().
   *
   * @returns {object}
   */
  static get sanitize() {
    return {
      content: {
        br: true,
        b: true,
        strong: true,
        i: true,
        em: true,
        u: true,
        s: true,
        mark: true,
        code: true,
        sub: true,
        sup: true,
        a: {
          href: true,
          target: true,
          rel: true
        },
        img: {
          src: true,
          alt: true,
          width: true,
          height: true,
          style: true
        }
      }
    };
  }

  /**
   * Build saved table data from pasted table HTML.
   *
   * Exposed as a static helper so host applications can intercept paste
   * before Editor.js routes clipboard files to the image tool.
   *
   * @param {HTMLTableElement} table
   * @param {object} config
   * @returns {Promise<{withHeadings: boolean, content: string[][]}>}
   */
  static async buildPastedTableData(table, config = {}) {
    const firstRowHeading = table.querySelector(':scope > thead, tr:first-of-type th');
    const uploader = config && config.uploader ? config.uploader : {};
    const content = await buildPastedTableContent(table, {
      uploadByFile: uploader.uploadByFile,
      uploadByUrl: uploader.uploadByUrl,
      importLocalSrc: uploader.importLocalSrc,
      clipboardFiles: config && config.clipboardFiles ? config.clipboardFiles : []
    });

    return {
      withHeadings: firstRowHeading !== null,
      content
    };
  }

  /**
   * On paste callback that is fired from Editor
   *
   * @param {PasteEvent} event - event with pasted data
   */
  async onPaste(event) {
    const table = event.detail.data;
    const pastedData = await TableBlock.buildPastedTableData(table, this.config);

    /** Update Tool's data */
    this.data = {
      withHeadings: pastedData.withHeadings,
      stretched: this.data.stretched,
      content: pastedData.content
    };

    /** Update table block */
    if (this.table.wrapper) {
      this.table.wrapper.replaceWith(this.render());
    }
  }
}
