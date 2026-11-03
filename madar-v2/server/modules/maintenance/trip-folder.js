import yauzl from 'yauzl';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { HttpError } from '../http.js';

export const TRIP_PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

const MAX_ZIP_BYTES = 20 * 1024 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 50000;
const MAX_ZIP_FILE_BYTES = 200 * 1024 * 1024;
const MAX_ZIP_UNCOMPRESSED_BYTES = 20 * 1024 * 1024 * 1024;
const COMMON_MACHINE_FOLDER_WORDS = new Set(['atm', 'ماكينه', 'ماكينات', 'فرع']);

function normalizeArabicDigits(value) {
  return String(value ?? '').replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

export function normalizeMachineFolderName(value, { ignoreCommonWords = true } = {}) {
  const normalized = normalizeArabicDigits(value)
    .normalize('NFKC')
    .toLocaleLowerCase('ar')
    .replace(/[أإآٱ]/gu, 'ا')
    .replace(/[ىئ]/gu, 'ي')
    .replace(/ة/gu, 'ه')
    .replace(/[\u0640\u064B-\u065F\u0670]/gu, '')
    .replace(/([\p{L}])(\p{N})/gu, '$1 $2')
    .replace(/(\p{N})(\p{L})/gu, '$1 $2')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const tokens = normalized.split(/\s+/u).filter(Boolean);
  return tokens
    .filter((token) => !ignoreCommonWords || !COMMON_MACHINE_FOLDER_WORDS.has(token))
    .join('');
}

export function matchMachineFolder(folderName, machines) {
  const raw = String(folderName ?? '').trim();
  if (!raw) return null;

  const splitTokens = (value) => String(value ?? '')
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/([\p{L}])(\p{N})/gu, '$1 $2')
    .replace(/(\p{N})(\p{L})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
  const normalizeToken = (value) => normalizeMachineFolderName(value);
  const tokens = splitTokens(raw);
  const normalizedTokens = tokens.map(normalizeToken).filter(Boolean);
  const rawNormalizedTokens = tokens.map((token) => normalizeMachineFolderName(token, { ignoreCommonWords: false }));
  const nameTokenScores = (machine) => [machine.name_ar, machine.name_en]
    .flatMap((name) => splitTokens(name).map((token) => normalizeMachineFolderName(token, { ignoreCommonWords: false })))
    .filter(Boolean)
    .filter((token, index, values) => values.indexOf(token) === index)
    .filter((token) => rawNormalizedTokens.includes(token)).length;
  const shortNumericNameMatches = machines
    .filter((machine) => /^\d{1,2}$/u.test(String(machine.code ?? '').trim()))
    .filter((machine) => {
      const code = Number.parseInt(machine.code, 10);
      return tokens.some((token) => /^\d+$/u.test(token) && Number.parseInt(token, 10) === code)
        && nameTokenScores(machine) >= 2;
    })
    .sort((a, b) => nameTokenScores(b) - nameTokenScores(a));
  if (shortNumericNameMatches.length
    && (shortNumericNameMatches.length === 1 || nameTokenScores(shortNumericNameMatches[0]) > nameTokenScores(shortNumericNameMatches[1]))) {
    return shortNumericNameMatches[0];
  }
  const hasTokenSequence = (sequence) => sequence.length > 0
    && sequence.length <= normalizedTokens.length
    && normalizedTokens.some((_, start) => sequence.every((token, offset) => (
      normalizedTokens[start + offset] === normalizeToken(token)
    )));

  // Keep separator-delimited codes exact, while also treating a multi-part code
  // (for example PARITY-02) as a contiguous sequence of standalone tokens.
  const exactTokenMatches = machines.filter((machine) => {
    const code = String(machine.code ?? '').trim();
    if (!code) return false;
    const shortNumericCode = /^\d{1,2}$/u.test(code);
    if (shortNumericCode) {
      const numericCode = Number.parseInt(code, 10);
      const numericFolderOnly = tokens.length === 1
        && /^\d+$/u.test(tokens[0])
        && Number.parseInt(tokens[0], 10) === numericCode;
      const explicitNumericLabel = tokens.length === 2
        && /^(?:atm|code)$/iu.test(tokens[0])
        && /^\d+$/u.test(tokens[1])
        && Number.parseInt(tokens[1], 10) === numericCode;
      return numericFolderOnly || explicitNumericLabel;
    }
    const normalizedCode = normalizeToken(code);
    if (normalizedCode && normalizedTokens.includes(normalizedCode)) return true;
    const codeTokens = splitTokens(code).map(normalizeToken).filter(Boolean);
    if (hasTokenSequence(codeTokens)) return true;
    if (/^\d+$/u.test(code)) {
      const numericCode = Number.parseInt(code, 10);
      return Number.isFinite(numericCode) && tokens.some((token) => (
        /^\d+$/u.test(token) && Number.parseInt(token, 10) === numericCode
      ));
    }
    return false;
  });

  if (exactTokenMatches.length === 1) return exactTokenMatches[0];

  if (exactTokenMatches.length > 1) {
    const shortNumericMatches = exactTokenMatches.filter((machine) => /^\d{1,2}$/u.test(String(machine.code ?? '').trim()));
    if (shortNumericMatches.length > 1) return null;
    const normFolder = normalizeMachineFolderName(raw, { ignoreCommonWords: false });
    const sorted = [...exactTokenMatches].sort((a, b) => {
      const aName = normalizeMachineFolderName(a.name_ar, { ignoreCommonWords: false });
      const bName = normalizeMachineFolderName(b.name_ar, { ignoreCommonWords: false });
      const aNameMatch = aName && normFolder.includes(aName) ? 1 : 0;
      const bNameMatch = bName && normFolder.includes(bName) ? 1 : 0;
      if (aNameMatch !== bNameMatch) return bNameMatch - aNameMatch;
      return String(b.code).length - String(a.code).length;
    });
    const best = sorted[0];
    const second = sorted[1];
    const bestNameMatch = [best.name_ar, best.name_en]
      .some((name) => normalizeMachineFolderName(name, { ignoreCommonWords: false })
        && normFolder.includes(normalizeMachineFolderName(name, { ignoreCommonWords: false })));
    const secondNameMatch = [second.name_ar, second.name_en]
      .some((name) => normalizeMachineFolderName(name, { ignoreCommonWords: false })
        && normFolder.includes(normalizeMachineFolderName(name, { ignoreCommonWords: false })));
    if (bestNameMatch === secondNameMatch && String(best.code).length === String(second.code).length) return null;
    return best;
  }

  // Exact normalized Arabic or English name, for legacy folders without codes.
  const normalizedFolder = normalizeMachineFolderName(raw);
  if (!normalizedFolder) return null;
  const exactNameMatches = machines.filter((machine) => [machine.name_ar, machine.name_en]
    .some((name) => normalizeMachineFolderName(name) === normalizedFolder));
  if (exactNameMatches.length === 1) return exactNameMatches[0];

  // A short branch label such as "فرع ديونز" can identify a longer Arabic
  // machine name, but only if the catalog name also identifies it as a branch.
  // This avoids confusing it with a similarly named compound/site.
  if (rawNormalizedTokens[0] === normalizeMachineFolderName('فرع', { ignoreCommonWords: false })) {
    const branchKeywords = rawNormalizedTokens.slice(1).filter(Boolean);
    const branchNameMatches = machines.filter((machine) => String(machine.name_ar ?? '')
      .split(/[\s\p{P}\p{S}]+/u)
      .map((token) => normalizeMachineFolderName(token, { ignoreCommonWords: false }))
      .filter(Boolean)
      .some((nameTokens) => nameTokens === normalizeMachineFolderName('فرع', { ignoreCommonWords: false }))
      && branchKeywords.every((keyword) => String(machine.name_ar ?? '')
        .split(/[\s\p{P}\p{S}]+/u)
        .map((token) => normalizeMachineFolderName(token, { ignoreCommonWords: false }))
        .includes(keyword)));
    if (branchNameMatches.length === 1) return branchNameMatches[0];
  }

  // Allow one uniquely identifying name to be contained by the folder, or vice versa.
  const containedNameMatches = machines.filter((machine) => [machine.name_ar, machine.name_en]
    .some((name) => {
      const normalizedName = normalizeMachineFolderName(name);
      return normalizedName.length >= 4
        && (normalizedFolder.includes(normalizedName) || normalizedName.includes(normalizedFolder));
    }));
  return containedNameMatches.length === 1 ? containedNameMatches[0] : null;
}

export function matchMachineFolderGroups(folderNames, machines) {
  const matches = folderNames.map((folderName) => ({ folderName, machine: matchMachineFolder(folderName, machines) }));
  const firstFolderByMachine = new Map();
  return matches.map((match) => {
    if (!match.machine) return { ...match, duplicate: false };
    const originalFolder = firstFolderByMachine.get(match.machine.id);
    if (originalFolder) {
      return {
        ...match,
        machine: null,
        duplicate: true,
        duplicateMachine: match.machine,
        duplicateOfFolder: originalFolder,
      };
    }
    firstFolderByMachine.set(match.machine.id, match.folderName);
    return { ...match, duplicate: false };
  });
}

function safeZipPath(filename) {
  if (typeof filename !== 'string' || !filename || filename.includes('\\') || filename.includes('\0') || filename.startsWith('/')) {
    throw new HttpError(400, 'The trip ZIP contains an unsafe file path.');
  }
  const clean = filename.endsWith('/') ? filename.slice(0, -1) : filename;
  const segments = clean.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes(':'))) {
    throw new HttpError(400, 'The trip ZIP contains an unsafe file path.');
  }
  return { clean, segments };
}

function extractZipEntry(zipfile, entry, destinationPath) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error) return reject(error);
      pipeline(stream, createWriteStream(destinationPath, { flags: 'wx', mode: 0o600 }))
        .then(resolve)
        .catch(async (streamError) => {
          try { await rm(destinationPath, { force: true }); } catch { /* retain the stream failure */ }
          reject(streamError);
        });
    });
  });
}

export async function readTripZip(zipPath, { tempDirectory, onProgress } = {}) {
  if (typeof zipPath !== 'string' || !zipPath || typeof tempDirectory !== 'string' || !tempDirectory) {
    throw new HttpError(400, 'A trip ZIP file and a temporary processing directory are required.');
  }
  const zipMetadata = await stat(zipPath);
  if (!zipMetadata.isFile() || zipMetadata.size === 0) throw new HttpError(400, 'A trip ZIP file is required.');
  if (zipMetadata.size > MAX_ZIP_BYTES) throw new HttpError(413, 'The trip ZIP exceeds the 20 GB upload limit.');

  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true, decodeStrings: true }, (openError, zipfile) => {
      if (openError) return reject(new HttpError(400, 'The uploaded trip ZIP could not be opened.'));

      const files = [];
      let entryCount = 0;
      let uncompressedBytes = 0;
      let totalFiles = Number.isInteger(zipfile.entryCount) ? zipfile.entryCount : 0;
      let processedFiles = 0;
      let settled = false;
      const markEntryProcessed = (stage) => {
        processedFiles += 1;
        if (totalFiles < processedFiles) totalFiles = processedFiles;
        onProgress?.({ totalFiles, processedFiles, stage });
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        try { zipfile.close(); } catch { /* already closed */ }
        reject(error instanceof HttpError ? error : new HttpError(400, 'The uploaded trip ZIP is invalid or damaged.'));
      };

      zipfile.once('error', fail);
      zipfile.once('end', () => {
        if (settled) return;
        settled = true;
        onProgress?.({ totalFiles, processedFiles, stage: 'اكتمل فحص ملفات ZIP.' });
        resolve(files);
      });

      onProgress?.({ totalFiles, processedFiles, stage: 'جارٍ قراءة قائمة ملفات ZIP...' });

      zipfile.on('entry', (entry) => {
        if (settled) return;
        entryCount += 1;
        if (!totalFiles) totalFiles = Math.max(entryCount, zipfile.entryCount ?? 0);
        if (entryCount > MAX_ZIP_ENTRIES) return fail(new HttpError(413, 'The trip ZIP contains too many entries.'));

        let path;
        try { path = safeZipPath(entry.fileName); }
        catch (error) { return fail(error); }

        const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
        if ((unixMode & 0o170000) === 0o120000) return fail(new HttpError(400, 'Symbolic links are not allowed in trip ZIP files.'));
        if (entry.fileName.endsWith('/')) {
          markEntryProcessed('جارٍ فحص مجلدات الرحلة...');
          zipfile.readEntry();
          return;
        }
        if ((entry.generalPurposeBitFlag & 1) !== 0) return fail(new HttpError(400, 'Encrypted trip ZIP files are not supported.'));

        const extension = extname(path.clean).toLowerCase();
        uncompressedBytes += entry.uncompressedSize;
        if (uncompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
          return fail(new HttpError(413, 'The trip ZIP expands beyond the 20 GB processing limit.'));
        }
        if (path.segments.some((segment) => segment.toLocaleLowerCase('en') === '.incoming')) {
          markEntryProcessed('جارٍ استبعاد مجلدات الرفع المؤقتة...');
          zipfile.readEntry();
          return;
        }
        if (!TRIP_PHOTO_EXTENSIONS.has(extension)) {
          markEntryProcessed('جارٍ تخطي الملفات غير المدعومة...');
          zipfile.readEntry();
          return;
        }
        if (entry.uncompressedSize > MAX_ZIP_FILE_BYTES) {
          return fail(new HttpError(413, 'A photo in the trip ZIP exceeds the 200 MB limit.'));
        }

        onProgress?.({ totalFiles, processedFiles, stage: `جارٍ فك وفحص ${path.segments.at(-1)}...` });
        const sourceAbsolutePath = join(tempDirectory, `${randomUUID()}${extension}`);
        extractZipEntry(zipfile, entry, sourceAbsolutePath).then(() => {
          if (settled) return;
          files.push({
            relativePath: path.clean,
            name: path.segments.at(-1),
            sourceAbsolutePath,
            modifiedAt: entry.getLastModDate?.()?.getTime() ?? null,
          });
          markEntryProcessed('جارٍ فك وفحص صور الرحلة...');
          zipfile.readEntry();
        }).catch(fail);
      });

      zipfile.readEntry();
    });
  });
}

function parseExifDate(exif) {
  if (!Buffer.isBuffer(exif) || exif.length < 14) return null;
  const header = exif.indexOf(Buffer.from('Exif\0\0'));
  const base = header >= 0 ? header + 6 : 0;
  const byteOrder = exif.subarray(base, base + 2).toString('ascii');
  if (byteOrder !== 'II' && byteOrder !== 'MM') return null;
  const littleEndian = byteOrder === 'II';
  const read16 = (offset) => offset >= 0 && offset + 2 <= exif.length
    ? littleEndian ? exif.readUInt16LE(offset) : exif.readUInt16BE(offset)
    : null;
  const read32 = (offset) => offset >= 0 && offset + 4 <= exif.length
    ? littleEndian ? exif.readUInt32LE(offset) : exif.readUInt32BE(offset)
    : null;
  if (read16(base + 2) !== 42) return null;
  const ifd0Offset = read32(base + 4);
  if (ifd0Offset === null) return null;

  function entriesAt(relativeOffset) {
    const start = base + relativeOffset;
    const count = read16(start);
    if (count === null || count > 4096 || start + 2 + count * 12 > exif.length) return [];
    return Array.from({ length: count }, (_, index) => start + 2 + index * 12);
  }

  function tagValue(entryOffset) {
    const tag = read16(entryOffset);
    const type = read16(entryOffset + 2);
    const count = read32(entryOffset + 4);
    if (type !== 2 || !count || count > 128) return null;
    const valueOffset = count <= 4 ? null : read32(entryOffset + 8);
    if (count > 4 && valueOffset === null) return null;
    const dataOffset = count <= 4 ? entryOffset + 8 : base + valueOffset;
    if (!Number.isFinite(dataOffset) || dataOffset < 0 || dataOffset + count > exif.length) return null;
    return { tag, value: exif.subarray(dataOffset, dataOffset + count).toString('ascii').replace(/\0.*$/, '') };
  }

  const ifd0 = entriesAt(ifd0Offset);
  const dateTime = ifd0.map(tagValue).find((item) => item?.tag === 0x0132)?.value;
  const exifPointerEntry = ifd0.find((entryOffset) => read16(entryOffset) === 0x8769);
  const exifOffset = exifPointerEntry ? read32(exifPointerEntry + 8) : null;
  const originalDate = exifOffset === null ? null
    : entriesAt(exifOffset).map(tagValue).find((item) => item?.tag === 0x9003 || item?.tag === 0x9004)?.value;
  return parseExifTimestamp(originalDate || dateTime);
}

function parseExifTimestamp(value) {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

function filenameTimestamp(filename) {
  const patterns = [
    /(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})[T _-](\d{2})[-:.](\d{2})[-:.](\d{2})/,
    /(20\d{2})(\d{2})(\d{2})[-_](\d{2})(\d{2})(\d{2})/,
    /(20\d{2})[-_.](\d{2})[-_.](\d{2})/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(filename);
    if (!match) continue;
    const parts = match.slice(1).map(Number);
    const [year, month, day, hour = 0, minute = 0, second = 0] = parts;
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) continue;
    const date = Date.UTC(year, month - 1, day, hour, minute, second);
    if (Number.isFinite(date)) return date;
  }
  return null;
}

export async function photoTimestamp(photo) {
  let exifTimestamp = null;
  try {
    const metadata = await sharp(photo.sourceAbsolutePath ?? photo.buffer, { failOn: 'none' }).metadata();
    exifTimestamp = parseExifDate(metadata.exif);
  } catch { /* retain raw source bytes; use the filename or filesystem timestamp */ }
  return exifTimestamp ?? filenameTimestamp(photo.name) ?? photo.modifiedAt ?? 0;
}

function phaseFromSegment(segment) {
  const value = normalizeMachineFolderName(segment);
  if (['before', 'قبل', 'قبلالصيانة'].includes(value)) return 'before';
  if (['after', 'بعد', 'بعدالصيانة'].includes(value)) return 'after';
  return null;
}

function phaseFromFilename(filename) {
  const value = normalizeMachineFolderName(filename);
  if (/^(before|قبل)(?:\d|[a-z])/.test(value) || value === 'before' || value.startsWith('قبل')) return 'before';
  if (/^(after|بعد)(?:\d|[a-z])/.test(value) || value === 'after' || value.startsWith('بعد')) return 'after';
  if (/^01/.test(value)) return 'before';
  if (/^02/.test(value)) return 'after';
  return null;
}

export async function classifyMachinePhotos(photos, onProgress) {
  const before = [];
  const after = [];
  const unspecified = [];
  let processedFiles = 0;

  for (const photo of photos) {
    const segments = photo.machineRelativePath.split('/').filter(Boolean);
    const nestedPhase = segments.map(phaseFromSegment).find(Boolean);
    if (nestedPhase) {
      (nestedPhase === 'before' ? before : after).push(photo);
    } else {
      const filenamePhase = phaseFromFilename(photo.name);
      if (filenamePhase) (filenamePhase === 'before' ? before : after).push(photo);
      else unspecified.push({ photo, timestamp: await photoTimestamp(photo) });
    }
    processedFiles += 1;
    onProgress?.({ processedFiles, totalFiles: photos.length });
  }

  unspecified.sort((a, b) => a.timestamp - b.timestamp || a.photo.relativePath.localeCompare(b.photo.relativePath));
  let beforeCount = Math.ceil(unspecified.length / 2);
  if (beforeCount > 0 && beforeCount < unspecified.length
    && unspecified[beforeCount - 1].timestamp === unspecified[beforeCount].timestamp) {
    const tiedTimestamp = unspecified[beforeCount].timestamp;
    while (beforeCount < unspecified.length && unspecified[beforeCount].timestamp === tiedTimestamp) beforeCount += 1;
  }
  unspecified.forEach(({ photo }, index) => (index < beforeCount ? before : after).push(photo));
  return { before, after };
}
