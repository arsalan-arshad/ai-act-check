// Synthesised image byte builders for tests. Metadata is real; pixels are flat colour (or absent).
import { deflateSync } from 'node:zlib';

const enc = new TextEncoder();

export function bytes(...parts: Array<string | Uint8Array | number[]>): Uint8Array {
  const arrays = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : Uint8Array.from(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

export function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  return bytes([0xff, marker, length >> 8, length & 255], payload);
}

/** SOI, the given segments, then SOS and fake entropy data. */
export function jpeg(...segments: Uint8Array[]): Uint8Array {
  return bytes([0xff, 0xd8], ...segments, [0xff, 0xda, 0x00, 0x04, 0x00, 0x00], 'compressed-data');
}

export function u16(value: number, little: boolean): number[] {
  return little ? [value & 255, value >> 8] : [value >> 8, value & 255];
}

export function u32(value: number, little: boolean): number[] {
  const b = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
  return little ? b.reverse() : b;
}

/** A TIFF structure with one IFD0 entry: Software (0x0131, ASCII). */
export function tiffWithSoftware(software: string, little = true): Uint8Array {
  const text = bytes(software, [0]);
  const inline = text.length <= 4;
  const valueOffset = 8 + 2 + 12 + 4;
  return bytes(
    little ? 'II' : 'MM',
    u16(42, little),
    u32(8, little),
    u16(1, little),
    u16(0x0131, little),
    u16(2, little),
    u32(text.length, little),
    inline ? [...text, ...Array<number>(4 - text.length).fill(0)] : u32(valueOffset, little),
    u32(0, little),
    inline ? [] : text,
  );
}

export function exifSegment(software: string, little = true): Uint8Array {
  return jpegSegment(0xe1, bytes('Exif\0\0', tiffWithSoftware(software, little)));
}

export function xmpPacket(inner: string): string {
  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">${inner}</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
}

export function xmpSegment(xmp: string): Uint8Array {
  return jpegSegment(0xe1, bytes('http://ns.adobe.com/xap/1.0/\0', xmp));
}

export function digitalSourceTypeXmp(term: string): string {
  return xmpPacket(
    `<rdf:Description xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/${term}"/>`,
  );
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function pngChunk(type: string, data: Uint8Array | string): Uint8Array {
  const payload = typeof data === 'string' ? enc.encode(data) : data;
  return bytes(u32(payload.length, false), type, payload, u32(crc32(bytes(type, payload)), false));
}

/** A real, decodable flat-colour RGB PNG with extra chunks (tEXt, caBX, ...) placed before the pixel data. */
export function validPng(width: number, height: number, ...extraChunks: Uint8Array[]): Uint8Array {
  const row = bytes([0], new Uint8Array(width * 3).fill(0x80));
  const raw = bytes(...Array.from({ length: height }, () => row));
  const ihdr = bytes(u32(width, false), u32(height, false), [8, 2, 0, 0, 0]);
  return bytes(PNG_SIGNATURE, pngChunk('IHDR', ihdr), ...extraChunks, pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', ''));
}

export function png(...chunks: Uint8Array[]): Uint8Array {
  return bytes(PNG_SIGNATURE, pngChunk('IHDR', new Uint8Array(13)), ...chunks, pngChunk('IEND', ''));
}
