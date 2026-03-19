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

function decodeBase64(base64) {
  if (typeof atob === 'function') {
    return atob(base64);
  }

  return Buffer.from(base64, 'base64').toString('binary');
}

function extensionFromMime(type = '') {
  const normalized = String(type || '').toLowerCase();

  if (normalized === 'image/jpeg') {
    return 'jpg';
  }

  if (normalized === 'image/svg+xml') {
    return 'svg';
  }

  const parts = normalized.split('/');
  return parts.length === 2 && parts[1] ? parts[1] : 'bin';
}

function createUploadableFile(blob, type = '') {
  if (typeof File !== 'function') {
    return blob;
  }

  const ext = extensionFromMime(type || blob.type);
  return new File([blob], `pasted-image.${ext}`, { type: type || blob.type || 'application/octet-stream' });
}

function normalizeClipboardFiles(files) {
  if (!files) {
    return [];
  }

  if (Array.isArray(files)) {
    return files.slice();
  }

  return Array.from(files);
}

function isTemporaryClipboardImageSrc(src) {
  return /^(file:|cid:|ms-appx:|about:blank$)/i.test(String(src || '').trim());
}

function normalizeFileName(name) {
  return String(name || '').trim().toLowerCase();
}

function getClipboardFileNameFromSrc(src) {
  const normalized = String(src || '').trim();

  if (!normalized) {
    return '';
  }

  const withoutQuery = normalized.split('#')[0].split('?')[0];
  const segments = withoutQuery.split(/[\\/]/);
  const last = segments[segments.length - 1] || withoutQuery;

  if (/^cid:/i.test(last)) {
    return normalizeFileName(last.replace(/^cid:/i, ''));
  }

  return normalizeFileName(last.replace(/^file:/i, ''));
}

function consumeClipboardImageFile(src, clipboardState = {}) {
  const unusedFiles = Array.isArray(clipboardState.imageFiles) ? clipboardState.imageFiles : [];
  const targetName = getClipboardFileNameFromSrc(src);

  if (targetName) {
    const matched = unusedFiles.find((entry) => entry && !entry.used && normalizeFileName(entry.file && entry.file.name) === targetName);
    if (matched) {
      matched.used = true;
      return matched.file;
    }
  }

  const fallback = unusedFiles.find((entry) => entry && !entry.used);
  if (!fallback) {
    return null;
  }

  fallback.used = true;
  return fallback.file;
}

export function dataUrlToFile(src) {
  const match = String(src || '').match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i);

  if (!match) {
    return null;
  }

  const mime = match[1] || 'application/octet-stream';
  const binary = decodeBase64(match[2]);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  const blob = new Blob([bytes], { type: mime });
  return createUploadableFile(blob, mime);
}

async function defaultFetchBlob(src) {
  const response = await fetch(src);

  if (!response || !response.ok) {
    throw new Error(`Failed to fetch pasted image: ${src}`);
  }

  const blob = await response.blob();
  return createUploadableFile(blob, blob.type);
}

async function resolveUploadedSrc(src, options = {}, clipboardState = {}) {
  const { uploadByFile, uploadByUrl, importLocalSrc, fetchBlob = defaultFetchBlob } = options;
  const normalizedSrc = String(src || '').trim();

  if (!normalizedSrc) {
    return normalizedSrc;
  }

  if (clipboardState.uploadedSrcByOriginal && clipboardState.uploadedSrcByOriginal.has(normalizedSrc)) {
    return await clipboardState.uploadedSrcByOriginal.get(normalizedSrc);
  }

  if (/^data:image\//i.test(normalizedSrc) && typeof uploadByFile === 'function') {
    const file = dataUrlToFile(normalizedSrc);
    const uploadedUrl = getUploadedUrl(await uploadByFile(file));
    return uploadedUrl || normalizedSrc;
  }

  if (/^blob:/i.test(normalizedSrc) && typeof uploadByFile === 'function') {
    const file = await fetchBlob(normalizedSrc);
    const uploadedUrl = getUploadedUrl(await uploadByFile(file));
    return uploadedUrl || normalizedSrc;
  }

  if (/^https?:\/\//i.test(normalizedSrc) && typeof uploadByUrl === 'function') {
    const uploadedUrl = getUploadedUrl(await uploadByUrl(normalizedSrc));
    return uploadedUrl || normalizedSrc;
  }

  if (isTemporaryClipboardImageSrc(normalizedSrc) && typeof uploadByFile === 'function') {
    const nextClipboardFile = consumeClipboardImageFile(normalizedSrc, clipboardState);
    if (nextClipboardFile) {
      const uploadTask = (async () => {
        const uploadedUrl = getUploadedUrl(await uploadByFile(nextClipboardFile));
        return uploadedUrl || normalizedSrc;
      })();

      if (clipboardState.uploadedSrcByOriginal) {
        clipboardState.uploadedSrcByOriginal.set(normalizedSrc, uploadTask);
      }

      const resolved = await uploadTask;

      if (clipboardState.uploadedSrcByOriginal) {
        clipboardState.uploadedSrcByOriginal.set(normalizedSrc, resolved);
      }

      return resolved;
    }
  }

  if (isTemporaryClipboardImageSrc(normalizedSrc) && typeof importLocalSrc === 'function') {
    const importTask = (async () => {
      const uploadedUrl = getUploadedUrl(await importLocalSrc(normalizedSrc));
      return uploadedUrl || normalizedSrc;
    })();

    if (clipboardState.uploadedSrcByOriginal) {
      clipboardState.uploadedSrcByOriginal.set(normalizedSrc, importTask);
    }

    const resolved = await importTask;

    if (clipboardState.uploadedSrcByOriginal) {
      clipboardState.uploadedSrcByOriginal.set(normalizedSrc, resolved);
    }

    return resolved;
  }

  return normalizedSrc;
}

async function rewriteCellImageSources(cell, options = {}) {
  const images = Array.from(cell.querySelectorAll('img[src]'));
  const clipboardState = options.__clipboardState || {};

  for (const image of images) {
    const nextSrc = await resolveUploadedSrc(image.getAttribute('src'), options, clipboardState);

    if (nextSrc) {
      image.setAttribute('src', nextSrc);
    }
  }
}

function parseDimension(value) {
  if (value == null || value === '') {
    return 0;
  }

  const match = String(value).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function getWrapperForImage(image) {
  const wrapper = image && image.parentElement;

  if (!wrapper) {
    return null;
  }

  if (!['SPAN', 'DIV'].includes(wrapper.tagName)) {
    return null;
  }

  if (wrapper.childElementCount !== 1 || wrapper.textContent.trim() !== '') {
    return null;
  }

  return wrapper;
}

function isExcelWrappedImage(image) {
  const wrapper = getWrapperForImage(image);

  if (!wrapper || !wrapper.style) {
    return false;
  }

  return wrapper.style.position === 'absolute' || /vglayout/i.test(wrapper.getAttribute('style') || '');
}

function getImageBoxMetrics(image) {
  const wrapper = getWrapperForImage(image);

  const width = Math.max(
    parseDimension(image.getAttribute('width')),
    parseDimension(wrapper && wrapper.style ? wrapper.style.width : '')
  );
  const height = Math.max(
    parseDimension(image.getAttribute('height')),
    parseDimension(wrapper && wrapper.style ? wrapper.style.height : '')
  );

  return { width, height };
}

function isMeaningfulExcelImage(image) {
  if (!isExcelWrappedImage(image)) {
    return true;
  }

  const { width, height } = getImageBoxMetrics(image);
  return width > 4 && height > 4;
}

function cleanupExcelImageMarkup(cell) {
  const images = Array.from(cell.querySelectorAll('img[src]'));
  const excelWrappedImages = images.filter((image) => isExcelWrappedImage(image));

  if (excelWrappedImages.length === 0) {
    return;
  }

  let keptMeaningfulImage = false;

  for (const image of excelWrappedImages) {
    const wrapper = getWrapperForImage(image);

    if (!isMeaningfulExcelImage(image) || keptMeaningfulImage) {
      if (wrapper) {
        wrapper.remove();
      } else {
        image.remove();
      }
      continue;
    }

    const cleanImage = image.cloneNode(true);
    cleanImage.removeAttribute('width');
    cleanImage.removeAttribute('height');
    cleanImage.removeAttribute('style');

    if (wrapper) {
      wrapper.replaceWith(cleanImage);
    } else {
      image.replaceWith(cleanImage);
    }

    keptMeaningfulImage = true;
  }

  for (const node of Array.from(cell.querySelectorAll('span,div'))) {
    if (!node.textContent.trim() && node.querySelector('img') === null) {
      node.remove();
    }
  }

  cell.innerHTML = cell.innerHTML.trim();
}

export function normalizeTableCellElement(cell) {
  cleanupExcelImageMarkup(cell);
  return cell;
}

export function normalizeTableCellHtml(content = '') {
  if (typeof content !== 'string' || !content) {
    return content;
  }

  if (typeof document !== 'object' || typeof document.createElement !== 'function') {
    return content;
  }

  const container = document.createElement('div');
  container.innerHTML = content;
  cleanupExcelImageMarkup(container);
  return container.innerHTML.trim();
}

function createClipboardStateFromFiles(files) {
  return {
    imageFiles: normalizeClipboardFiles(files)
      .filter((file) => {
        const type = file && file.type ? String(file.type) : '';
        return /^image\//i.test(type);
      })
      .map((file) => ({ file, used: false })),
    uploadedSrcByOriginal: new Map()
  };
}

/**
 * Assetize images within a single table cell element in-place:
 * - Uploads data:/blob:/http(s):/temporary file sources (when uploader is provided)
 * - Rewrites <img src> to uploaded URLs
 * - Normalizes Excel-specific wrappers/placeholder artifacts
 *
 * @param {HTMLElement} cell
 * @param {object} options
 * @param {(file: File|Blob) => Promise<any>} [options.uploadByFile]
 * @param {(url: string) => Promise<any>} [options.uploadByUrl]
 * @param {(url: string) => Promise<any>} [options.importLocalSrc]
 * @param {Array<File|Blob>} [options.clipboardFiles]
 * @param {(src: string) => Promise<File|Blob>} [options.fetchBlob]
 * @returns {Promise<void>}
 */
export async function assetizeTableCellElement(cell, options = {}) {
  if (!cell || typeof cell.querySelectorAll !== 'function') {
    return;
  }

  const clipboardState = createClipboardStateFromFiles(options.clipboardFiles);

  await rewriteCellImageSources(cell, {
    ...options,
    __clipboardState: clipboardState
  });

  normalizeTableCellElement(cell);
}

export async function buildPastedTableContent(table, options = {}) {
  const rows = Array.from(table.querySelectorAll('tr'));
  const clipboardState = createClipboardStateFromFiles(options.clipboardFiles);

  return Promise.all(rows.map(async (row) => {
    const cells = Array.from(row.querySelectorAll('th, td'));

    return Promise.all(cells.map(async (cell) => {
      const workingCell = cell.cloneNode(true);
      await rewriteCellImageSources(workingCell, {
        ...options,
        __clipboardState: clipboardState
      });
      normalizeTableCellElement(workingCell);
      return workingCell.innerHTML;
    }));
  }));
}
