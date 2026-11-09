import type { ImageMarkers } from '../types.js';

// Pure byte-level inspection of image metadata. Pixels are never decoded. Everything here works on the
// first bytes of a file (the crawler reads a bounded prefix), so every read is bounds-checked and a
// truncated or malformed file simply yields fewer markers instead of an error.

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'isobmff' | 'tiff' | 'other';

const AI_TERMS = ['compositeWithTrainedAlgorithmicMedia', 'trainedAlgorithmicMedia', 'algorithmicMedia', 'compositeSynthetic'];
const AI_TERM_RE = new RegExp(`(?:https?://[^\\s"'<>]*/)?(?:${AI_TERMS.join('|')})(?![A-Za-z])`);

const TOOL_HINTS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Midjourney', /midjourney/i],
  ['DALL-E', /\bdall[\s\-·.]?e\b/i],
  ['Stable Diffusion', /stable[\s-]?diffusion/i],
  ['Adobe Firefly', /\bfirefly\b/i],
  ['Imagen', /\bimagen\b/i],
  ['Flux', /\bflux\b/i],
  ['Sora', /\bsora\b/i],
  ['ChatGPT', /\bchatgpt\b/i],
  ['OpenAI', /\bopenai\b/i],
];

const MAX_XMP_PACKETS = 3;
const MAX_TEXT = 200;

export function detectImageFormat(b: Uint8Array): ImageFormat {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') return 'isobmff';
  if (b.length >= 4 && ((ascii(b, 0, 2) === 'II' && b[2] === 0x2a && b[3] === 0) || (ascii(b, 0, 2) === 'MM' && b[2] === 0 && b[3] === 0x2a))) {
    return 'tiff';
  }
  return 'other';
}

export function extractImageMarkers(bytes: Uint8Array): ImageMarkers {
  const format = detectImageFormat(bytes);
  const texts: string[] = [];
  let c2pa = false;
  let exifSoftware: string | null = null;

  if (format === 'jpeg') {
    const jpeg = scanJpeg(bytes);
    c2pa = jpeg.c2pa;
    exifSoftware = jpeg.exifSoftware;
    texts.push(...jpeg.texts);
  } else if (format === 'png') {
    const png = scanPng(bytes);
    c2pa = png.c2pa;
    exifSoftware = png.exifSoftware;
    texts.push(...png.texts);
  } else if (format === 'webp' || format === 'isobmff' || format === 'tiff') {
    const raw = ascii(bytes, 0, bytes.length);
    c2pa = /c2pa/i.test(raw) || raw.includes('jumb');
    if (format === 'tiff') exifSoftware = readTiffSoftware(bytes, 0);
  } else {
    return { c2pa: false, iptcDigitalSourceType: null, aiToolHints: [], exifSoftware: null };
  }

  const xmpPackets = findXmpPackets(bytes);
  texts.push(...xmpPackets);
  if (exifSoftware) texts.push(exifSoftware);

  let iptcDigitalSourceType: string | null = null;
  for (const xmp of xmpPackets) {
    iptcDigitalSourceType = findDigitalSourceType(xmp);
    if (iptcDigitalSourceType) break;
  }

  const haystack = texts.join('\n');
  const aiToolHints = TOOL_HINTS.filter(([, re]) => re.test(haystack)).map(([name]) => name);
  return { c2pa, iptcDigitalSourceType, aiToolHints, exifSoftware };
}

function ascii(b: Uint8Array, start: number, length: number): string {
  const end = Math.min(b.length, start + length);
  let out = '';
  for (let i = Math.max(0, start); i < end; i += 8192) {
    out += String.fromCharCode(...b.subarray(i, Math.min(end, i + 8192)));
  }
  return out;
}

function utf8(b: Uint8Array, start: number, end: number): string {
  return new TextDecoder('utf-8').decode(b.subarray(start, Math.min(end, b.length)));
}

function u16(b: Uint8Array, o: number, little: boolean): number {
  return little ? b[o]! | (b[o + 1]! << 8) : (b[o]! << 8) | b[o + 1]!;
}

function u32(b: Uint8Array, o: number, little: boolean): number {
  const v = little
    ? b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)
    : (b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!;
  return v >>> 0;
}

function findXmpPackets(bytes: Uint8Array): string[] {
  const raw = ascii(bytes, 0, bytes.length);
  const packets: string[] = [];
  let from = 0;
  while (packets.length < MAX_XMP_PACKETS) {
    const start = raw.indexOf('<x:xmpmeta', from);
    if (start < 0) break;
    const closeAt = raw.indexOf('</x:xmpmeta>', start);
    const end = closeAt < 0 ? raw.length : closeAt + '</x:xmpmeta>'.length;
    packets.push(utf8(bytes, start, end));
    from = end;
  }
  return packets;
}

function findDigitalSourceType(xmp: string): string | null {
  let from = 0;
  for (;;) {
    const at = xmp.indexOf('DigitalSourceType', from);
    if (at < 0) return null;
    const next = xmp.indexOf('DigitalSourceType', at + 1);
    const window = xmp.slice(at, Math.min(at + 300, next < 0 ? xmp.length : next));
    const match = AI_TERM_RE.exec(window);
    if (match) return match[0];
    if (next < 0) return null;
    from = next;
  }
}

interface ScanResult {
  c2pa: boolean;
  exifSoftware: string | null;
  texts: string[];
}

function scanJpeg(b: Uint8Array): ScanResult {
  const result: ScanResult = { c2pa: false, exifSoftware: null, texts: [] };
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) break;
    const marker = b[o + 1]!;
    if (marker === 0xff) {
      o += 1;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image: no more metadata
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      o += 2;
      continue;
    }
    const length = u16(b, o + 2, false);
    if (length < 2) break;
    const start = o + 4;
    const end = Math.min(b.length, o + 2 + length);
    if (marker === 0xeb) {
      const head = ascii(b, start, 16);
      const body = ascii(b, start, end - start);
      if (head.includes('jumb') || body.includes('c2pa')) result.c2pa = true;
    } else if (marker === 0xe1 && ascii(b, start, 6) === 'Exif\0\0') {
      result.exifSoftware ??= readTiffSoftware(b.subarray(0, end), start + 6);
    } else if (marker === 0xfe) {
      result.texts.push(utf8(b, start, end));
    }
    o += 2 + length;
  }
  return result;
}

function scanPng(b: Uint8Array): ScanResult {
  const result: ScanResult = { c2pa: false, exifSoftware: null, texts: [] };
  let o = 8;
  while (o + 8 <= b.length) {
    const length = u32(b, o, false);
    const type = ascii(b, o + 4, 4);
    const start = o + 8;
    const end = Math.min(b.length, start + length);
    if (type === 'caBX') {
      result.c2pa = true;
    } else if (type === 'eXIf') {
      result.exifSoftware ??= readTiffSoftware(b.subarray(0, end), start);
    } else if (type === 'tEXt') {
      result.texts.push(ascii(b, start, end - start).replace(/\0/g, ' '));
    } else if (type === 'iTXt') {
      result.texts.push(readInternationalText(b, start, end));
    }
    if (type !== 'IDAT' && type !== 'tEXt' && type !== 'iTXt' && ascii(b, start, end - start).includes('c2pa')) result.c2pa = true;
    if (type === 'IEND' || length > b.length) break;
    o = start + length + 4;
  }
  return result;
}

function readInternationalText(b: Uint8Array, start: number, end: number): string {
  let o = start;
  while (o < end && b[o] !== 0) o++; // keyword
  const keyword = utf8(b, start, o);
  const compressed = b[o + 1] === 1;
  if (compressed) return keyword;
  o += 3; // NUL, compression flag, compression method
  for (let nuls = 0; nuls < 2 && o < end; o++) if (b[o] === 0) nuls++; // language tag, translated keyword
  return `${keyword} ${utf8(b, o, end)}`;
}

/** Reads the ASCII Software tag (0x0131) from IFD0 of a TIFF structure that starts at `base`. */
function readTiffSoftware(b: Uint8Array, base: number): string | null {
  if (base + 8 > b.length) return null;
  const order = ascii(b, base, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const little = order === 'II';
  if (u16(b, base + 2, little) !== 42) return null;
  const ifd = base + u32(b, base + 4, little);
  if (ifd + 2 > b.length) return null;
  const count = u16(b, ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > b.length) return null;
    if (u16(b, entry, little) !== 0x0131 || u16(b, entry + 2, little) !== 2) continue;
    const size = u32(b, entry + 4, little);
    const valueAt = size <= 4 ? entry + 8 : base + u32(b, entry + 8, little);
    if (valueAt + size > b.length || size === 0) return null;
    const value = ascii(b, valueAt, Math.min(size, MAX_TEXT)).replace(/\0.*$/s, '').trim();
    return value === '' ? null : value;
  }
  return null;
}
