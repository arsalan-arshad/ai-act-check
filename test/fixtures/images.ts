// Synthesizes tiny PNG/JPEG files carrying (synthetic) AI-provenance markers, and writes the
// image fixture sites. No real vendor assets: these bytes only mimic the container structures
// (PNG caBX chunk, JPEG APP11 JUMBF, XMP packet, tEXt) that a metadata scanner looks for.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { SITES_DIR } from './server.js';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** ISO BMFF style box: 4-byte big-endian size, 4-char type, payload. */
function box(type: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + payload.length);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, payload]);
}

/** A synthetic JUMBF superbox labelled c2pa. It is NOT a valid signed manifest. */
export function fakeJumbf(): Buffer {
  const c2paUuid = Buffer.from('63327061001100108000' + '00aa00389b71', 'hex');
  const jumd = box('jumd', Buffer.concat([c2paUuid, Buffer.from([0x03]), Buffer.from('c2pa\0', 'latin1')]));
  const content = box('json', Buffer.from('{"synthetic":"fixture manifest placeholder"}', 'utf8'));
  return box('jumb', Buffer.concat([jumd, content]));
}

export function xmpPacket(extraDescription = ''): string {
  return (
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" ' +
    'Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"' +
    (extraDescription ? ` ${extraDescription}` : '') +
    '/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
  );
}

export interface PngOptions {
  caBX?: boolean;
  xmp?: boolean;
  /** tEXt chunks as [keyword, text]. */
  text?: Array<[string, string]>;
  /** RGB colour of the solid image. */
  rgb?: [number, number, number];
}

export function makePng(opts: PngOptions = {}): Buffer {
  const w = 64;
  const h = 64;
  const [r, g, b] = opts.rgb ?? [200, 120, 40];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const parts: Buffer[] = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr)];
  for (const [k, v] of opts.text ?? []) parts.push(pngChunk('tEXt', Buffer.from(`${k}\0${v}`, 'latin1')));
  if (opts.xmp) {
    const keyword = Buffer.from('XML:com.adobe.xmp\0', 'latin1');
    const meta = Buffer.concat([Buffer.from([0, 0]), Buffer.from('\0\0', 'latin1')]);
    parts.push(pngChunk('iTXt', Buffer.concat([keyword, meta, Buffer.from(xmpPacket(), 'utf8')])));
  }
  if (opts.caBX) parts.push(pngChunk('caBX', fakeJumbf()));
  parts.push(pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// 64x64 baseline JPEG rendered once by Chromium's canvas encoder (tiny 1x1 images look like tracking pixels).
const BASE_JPEG = fs.readFileSync(new URL('./shared/base64x64.jpg', import.meta.url));

export interface JpegOptions {
  jumbf?: boolean;
  xmp?: boolean;
  /** Free-text tool hint written into the XMP packet's creator tool. */
  creatorTool?: string;
}

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

export function makeJpeg(opts: JpegOptions = {}): Buffer {
  const segs: Buffer[] = [];
  if (opts.xmp) {
    const ns = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1');
    const extra = opts.creatorTool ? `xmp:CreatorTool="${opts.creatorTool}"` : '';
    segs.push(jpegSegment(0xe1, Buffer.concat([ns, Buffer.from(xmpPacket(extra), 'utf8')])));
  }
  if (opts.jumbf) {
    // JPEG XT / JUMBF in APP11: 'JP', box instance (2 bytes), sequence number (4 bytes), then box.
    const hdr = Buffer.from([0x4a, 0x50, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01]);
    segs.push(jpegSegment(0xeb, Buffer.concat([hdr, fakeJumbf()])));
  }
  return Buffer.concat([BASE_JPEG.subarray(0, 2), ...segs, BASE_JPEG.subarray(2)]);
}

export const IMAGES = {
  'c2pa.png': () => makePng({ caBX: true }),
  'c2pa.jpg': () => makeJpeg({ jumbf: true }),
  'iptc.png': () => makePng({ xmp: true, rgb: [30, 90, 200] }),
  'iptc.jpg': () => makeJpeg({ xmp: true }),
  'midjourney.png': () => makePng({ text: [['Comment', 'Generated with Midjourney v6 job 0000-synthetic']], rgb: [20, 160, 90] }),
  'clean.png': () => makePng({ rgb: [128, 128, 128] }),
} as const;

function figure(src: string, alt: string, caption?: string): string {
  const img = `<img src="${src}" alt="${alt}" width="320" height="200">`;
  return caption === undefined ? `<div class="card">${img}</div>` : `<figure>${img}<figcaption>${caption}</figcaption></figure>`;
}

interface MediaSite {
  name: string;
  body: string;
  files: Array<keyof typeof IMAGES>;
}

export const MEDIA_SITES: MediaSite[] = [
  { name: 'media-c2pa-labelled-caption', files: ['c2pa.png'], body: figure('/img/c2pa.png', 'City skyline', 'AI-generated image: a city skyline') },
  { name: 'media-c2pa-unlabelled', files: ['c2pa.png'], body: figure('/img/c2pa.png', 'Office building', 'Our office building') },
  { name: 'media-c2pa-jpeg-labelled-alt', files: ['c2pa.jpg'], body: figure('/img/c2pa.jpg', 'Made with AI: lighthouse at dusk') },
  { name: 'media-iptc-labelled-alt', files: ['iptc.png'], body: figure('/img/iptc.png', 'KI-generiert: Skyline bei Nacht') },
  { name: 'media-iptc-unlabelled-jpeg', files: ['iptc.jpg'], body: figure('/img/iptc.jpg', 'Skyline at night') },
  { name: 'media-tool-hint', files: ['midjourney.png'], body: figure('/img/midjourney.png', 'Mountain view', 'A mountain landscape') },
  { name: 'media-clean', files: ['clean.png'], body: figure('/img/clean.png', 'Plain photo', 'A plain photo') },
  {
    name: 'media-mixed',
    files: ['c2pa.png', 'iptc.jpg'],
    body: figure('/img/c2pa.png', 'Hero', 'AI-generated image of a hero') + figure('/img/iptc.jpg', 'Office', 'Our office'),
  },
  { name: 'media-unreadable', files: [], body: figure('/img/missing.png', 'Missing image', 'Gone') },
];

/** Idempotently write the media fixture sites (HTML + synthesized image files). */
export function writeImageFixtures(): void {
  for (const site of MEDIA_SITES) {
    const dir = path.join(SITES_DIR, site.name);
    fs.mkdirSync(path.join(dir, 'img'), { recursive: true });
    const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${site.name}</title></head>\n<body>\n<h1>Gallery</h1>\n${site.body}\n</body></html>\n`;
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    for (const f of site.files) fs.writeFileSync(path.join(dir, 'img', f), IMAGES[f]());
  }
}
