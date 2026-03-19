import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { assetizeTableCellElement, buildPastedTableContent } from '../src/pasteImageAssetization.mjs';

function createTable(html) {
  const dom = new JSDOM(html);
  return dom.window.document.querySelector('table');
}

test('uploads data URI images and rewrites cell HTML to uploaded URLs', async () => {
  const table = createTable(`
    <table>
      <tr>
        <td>Alpha<img src="data:image/png;base64,aGVsbG8=" alt="inline"></td>
      </tr>
    </table>
  `);

  let uploadedBlob = null;

  const content = await buildPastedTableContent(table, {
    uploadByFile: async (blob) => {
      uploadedBlob = blob;
      return { success: 1, file: { url: '/uploads/pasted-inline.png' } };
    }
  });

  assert.equal(content[0][0], 'Alpha<img src="/uploads/pasted-inline.png" alt="inline">');
  assert.equal(uploadedBlob.type, 'image/png');
});

test('uploads blob images via fetch and rewrites cell HTML to uploaded URLs', async () => {
  const table = createTable(`
    <table>
      <tr>
        <td><img src="blob:https://example.test/123" alt="blob"></td>
      </tr>
    </table>
  `);

  const content = await buildPastedTableContent(table, {
    fetchBlob: async (src) => {
      assert.equal(src, 'blob:https://example.test/123');
      return new Blob(['blob-image'], { type: 'image/png' });
    },
    uploadByFile: async () => ({ success: 1, file: { url: '/uploads/pasted-blob.png' } })
  });

  assert.equal(content[0][0], '<img src="/uploads/pasted-blob.png" alt="blob">');
});

test('uploads remote image URLs through uploadByUrl when provided', async () => {
  const table = createTable(`
    <table>
      <tr>
        <td><img src="https://example.com/logo.png" alt="remote"></td>
      </tr>
    </table>
  `);

  const content = await buildPastedTableContent(table, {
    uploadByUrl: async (src) => {
      assert.equal(src, 'https://example.com/logo.png');
      return { success: 1, file: { url: '/uploads/remote-logo.png' } };
    }
  });

  assert.equal(content[0][0], '<img src="/uploads/remote-logo.png" alt="remote">');
});

test('uploads clipboard image files when excel html uses temporary file URLs', async () => {
  const table = createTable(`
    <table>
      <tr>
        <td><img src="file:///C:/Users/test/AppData/Local/Temp/clip_image001.png" alt="excel"></td>
      </tr>
    </table>
  `);

  const clipboardFile = new File(['excel-image'], 'clip_image001.png', { type: 'image/png' });
  let uploadedFile = null;

  const content = await buildPastedTableContent(table, {
    clipboardFiles: [clipboardFile],
    uploadByFile: async (file) => {
      uploadedFile = file;
      return { success: 1, file: { url: '/uploads/excel-clip.png' } };
    }
  });

  assert.equal(content[0][0], '<img src="/uploads/excel-clip.png" alt="excel">');
  assert.equal(uploadedFile.name, 'clip_image001.png');
});

test('matches temporary excel image URLs to clipboard files by filename before falling back to order', async () => {
  const table = createTable(`
    <table>
      <tr>
        <td><img src="file:///C:/Temp/clip_image002.png" alt="excel-2"></td>
      </tr>
    </table>
  `);

  const firstFile = new File(['first'], 'clip_image001.png', { type: 'image/png' });
  const secondFile = new File(['second'], 'clip_image002.png', { type: 'image/png' });
  let uploadedFile = null;

  const content = await buildPastedTableContent(table, {
    clipboardFiles: [firstFile, secondFile],
    uploadByFile: async (file) => {
      uploadedFile = file;
      return { success: 1, file: { url: '/uploads/excel-clip-002.png' } };
    }
  });

  assert.equal(content[0][0], '<img src="/uploads/excel-clip-002.png" alt="excel-2">');
  assert.equal(uploadedFile.name, 'clip_image002.png');
});

test('reuses uploaded URL for repeated temporary excel image sources', async () => {
  const table = createTable(`
    <table>
      <tr>
        <td><img src="file:///C:/Temp/clip_image001.png" alt="excel-a"></td>
        <td><img src="file:///C:/Temp/clip_image001.png" alt="excel-b"></td>
      </tr>
    </table>
  `);

  const clipboardFile = new File(['excel-image'], 'clip_image001.png', { type: 'image/png' });
  let uploadCalls = 0;

  const content = await buildPastedTableContent(table, {
    clipboardFiles: [clipboardFile],
    uploadByFile: async () => {
      uploadCalls += 1;
      return { success: 1, file: { url: '/uploads/excel-clip-shared.png' } };
    }
  });

  assert.equal(uploadCalls, 1);
  assert.equal(content[0][0], '<img src="/uploads/excel-clip-shared.png" alt="excel-a">');
  assert.equal(content[0][1], '<img src="/uploads/excel-clip-shared.png" alt="excel-b">');
});

test('falls back to importing local clipboard temp image URLs when clipboard file is unavailable', async () => {
  const table = createTable(`
    <table>
      <tr>
        <td><img src="file:///C:/Users/test/AppData/Local/Temp/ksohtml/clip_image10.png" alt="excel-local"></td>
      </tr>
    </table>
  `);

  let importedSrc = null;

  const content = await buildPastedTableContent(table, {
    importLocalSrc: async (src) => {
      importedSrc = src;
      return { success: 1, file: { url: '/uploads/excel-local-import.png' } };
    }
  });

  assert.equal(importedSrc, 'file:///C:/Users/test/AppData/Local/Temp/ksohtml/clip_image10.png');
  assert.equal(content[0][0], '<img src="/uploads/excel-local-import.png" alt="excel-local">');
});

test('flattens excel absolute-position wrappers and keeps only the first meaningful image in a cell', async () => {
  const table = createTable(`
    <table>
      <tr>
        <td>
          <span style="mso-ignore:vglayout;position:absolute;margin-left:0px;margin-top:0px;width:179px;height:139px;visibility:visible">
            <img width="179" height="139" src="https://example.com/primary.png" alt="primary">
          </span>
          <span style="mso-ignore:vglayout;position:absolute;margin-left:0px;margin-top:25px;width:179px;height:139px;visibility:visible">
            <img width="179" height="139" src="https://example.com/duplicate.png" alt="duplicate">
          </span>
          <span style="mso-ignore:vglayout;position:absolute;margin-left:0px;margin-top:25px;width:1px;height:1px;visibility:visible">
            <img width="1" height="1" src="https://example.com/placeholder.png" alt="placeholder">
          </span>
        </td>
      </tr>
    </table>
  `);

  const content = await buildPastedTableContent(table, {});

  assert.equal(content[0][0], '<img src="https://example.com/primary.png" alt="primary">');
});

test('drops excel placeholder-only images from a cell', async () => {
  const table = createTable(`
    <table>
      <tr>
        <td>
          <span style="mso-ignore:vglayout;position:absolute;margin-left:0px;margin-top:24px;width:1px;height:1px;visibility:visible">
            <img width="1" height="1" src="https://example.com/placeholder.png" alt="placeholder">
          </span>
        </td>
      </tr>
    </table>
  `);

  const content = await buildPastedTableContent(table, {});

  assert.equal(content[0][0], '');
});

test('table sanitize config keeps uploaded image tags in cell html', () => {
  const pluginSource = fs.readFileSync(path.join(process.cwd(), 'src', 'plugin.js'), 'utf8');

  assert.match(pluginSource, /static get sanitize\(\)/);
  assert.match(pluginSource, /img:\s*\{/);
  assert.match(pluginSource, /src:\s*true/);
  assert.match(pluginSource, /alt:\s*true/);
});

test('table styles constrain inline images to a consistent thumbnail box', () => {
  const stylesSource = fs.readFileSync(path.join(process.cwd(), 'src', 'styles', 'table.pcss'), 'utf8');

  assert.match(stylesSource, /&--media\s*\{/);
  assert.match(stylesSource, /padding-top:\s*2px/);
  assert.match(stylesSource, /padding-bottom:\s*2px/);
  assert.match(stylesSource, /\n\s+img\s*\{/);
  assert.match(stylesSource, /max-width:\s*var\(--cell-image-max-width\)/);
  assert.match(stylesSource, /max-height:\s*var\(--cell-image-max-height\)/);
  assert.match(stylesSource, /margin:\s*0 auto/);
  assert.match(stylesSource, /object-fit:\s*contain/);
  assert.match(stylesSource, /cursor:\s*zoom-in/);
});

test('table source opens uploaded image urls in a new tab on click', () => {
  const tableSource = fs.readFileSync(path.join(process.cwd(), 'src', 'table.js'), 'utf8');

  assert.match(tableSource, /handleImageClick/);
  assert.match(tableSource, /window\.open\(src,\s*'_blank',\s*'noopener,noreferrer'\)/);
});

test('table source normalizes excel image wrappers before rendering saved cell html', () => {
  const tableSource = fs.readFileSync(path.join(process.cwd(), 'src', 'table.js'), 'utf8');

  assert.match(tableSource, /normalizeTableCellHtml/);
});

test('keeps original cell HTML when no uploader is configured', async () => {
  const table = createTable(`
    <table>
      <tr>
        <td>Plain<img src="data:image/png;base64,aGVsbG8=" alt="inline"></td>
      </tr>
    </table>
  `);

  const content = await buildPastedTableContent(table, {});

  assert.equal(content[0][0], 'Plain<img src="data:image/png;base64,aGVsbG8=" alt="inline">');
});

test('assetizeTableCellElement rewrites image sources in-place for a single cell', async () => {
  const dom = new JSDOM(`<div id="cell">X<img src="data:image/png;base64,aGVsbG8=" alt="inline"></div>`);
  const cell = dom.window.document.getElementById('cell');

  await assetizeTableCellElement(cell, {
    uploadByFile: async () => ({ success: 1, file: { url: '/uploads/cell-inline.png' } })
  });

  assert.equal(cell.innerHTML, 'X<img src="/uploads/cell-inline.png" alt="inline">');
});
