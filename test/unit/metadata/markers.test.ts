import { describe, expect, it } from 'vitest';
import { detectImageFormat, extractImageMarkers } from '../../../src/metadata/markers.js';
import {
  bytes,
  digitalSourceTypeXmp,
  exifSegment,
  jpeg,
  jpegSegment,
  png,
  pngChunk,
  xmpPacket,
  xmpSegment,
} from './builders.js';

const EMPTY = { c2pa: false, iptcDigitalSourceType: null, aiToolHints: [], exifSoftware: null };

describe('detectImageFormat', () => {
  it('recognises formats from magic bytes', () => {
    expect(detectImageFormat(jpeg())).toBe('jpeg');
    expect(detectImageFormat(png())).toBe('png');
    expect(detectImageFormat(bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8 '))).toBe('webp');
    expect(detectImageFormat(bytes([0, 0, 0, 24], 'ftypavif', 'mif1'))).toBe('isobmff');
    expect(detectImageFormat(bytes('II', [42, 0, 8, 0, 0, 0]))).toBe('tiff');
    expect(detectImageFormat(bytes('MM', [0, 42, 0, 0, 0, 8]))).toBe('tiff');
  });

  it('treats svg, gif and garbage as other', () => {
    expect(detectImageFormat(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('other');
    expect(detectImageFormat(bytes('GIF89a'))).toBe('other');
    expect(detectImageFormat(new Uint8Array(0))).toBe('other');
  });
});

describe('extractImageMarkers: robustness', () => {
  it('returns empty markers for clean images', () => {
    expect(extractImageMarkers(jpeg())).toEqual(EMPTY);
    expect(extractImageMarkers(png())).toEqual(EMPTY);
  });

  it('returns empty markers for unknown formats and empty input', () => {
    expect(extractImageMarkers(new Uint8Array(0))).toEqual(EMPTY);
    expect(extractImageMarkers(bytes('<svg><metadata>Midjourney c2pa</metadata></svg>'))).toEqual(EMPTY);
  });

  it('does not throw on truncated or corrupt data', () => {
    const full = jpeg(exifSegment('Midjourney V6'), xmpSegment(digitalSourceTypeXmp('trainedAlgorithmicMedia')));
    for (let cut = 0; cut < full.length; cut += 7) {
      expect(() => extractImageMarkers(full.subarray(0, cut))).not.toThrow();
    }
    const pngFull = png(pngChunk('tEXt', 'Software\0Midjourney'));
    for (let cut = 0; cut < pngFull.length; cut += 5) {
      expect(() => extractImageMarkers(pngFull.subarray(0, cut))).not.toThrow();
    }
    const garbage = new Uint8Array(5000).map((_, i) => (i * 31) % 251);
    expect(() => extractImageMarkers(bytes([0xff, 0xd8, 0xff], garbage))).not.toThrow();
    expect(() => extractImageMarkers(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], garbage))).not.toThrow();
  });

  it('handles a JPEG segment whose declared length runs past the data', () => {
    const broken = bytes([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff], 'Exif\0\0II');
    expect(extractImageMarkers(broken)).toEqual(EMPTY);
  });
});

describe('extractImageMarkers: C2PA / JUMBF', () => {
  it('detects a JUMBF box in a JPEG APP11 segment', () => {
    const jumbf = jpegSegment(0xeb, bytes('JP', [0, 1, 0, 0, 0, 1], [0, 0, 0, 40], 'jumb', [0, 0, 0, 20], 'jumd', 'c2pa'));
    expect(extractImageMarkers(jpeg(jumbf)).c2pa).toBe(true);
  });

  it('detects a c2pa label inside an APP11 segment even without a leading jumb box', () => {
    expect(extractImageMarkers(jpeg(jpegSegment(0xeb, bytes('xxxxxxxxxxxxxxxxxxxxxxxxxxxxc2pa')))).c2pa).toBe(true);
  });

  it('does not flag an unrelated APP11 segment or other segments mentioning nothing', () => {
    expect(extractImageMarkers(jpeg(jpegSegment(0xeb, bytes('some other data')))).c2pa).toBe(false);
    expect(extractImageMarkers(jpeg(jpegSegment(0xe0, bytes('JFIF\0')))).c2pa).toBe(false);
  });

  it('detects the PNG caBX chunk', () => {
    expect(extractImageMarkers(png(pngChunk('caBX', bytes([0, 0, 0, 8], 'jumb')))).c2pa).toBe(true);
  });

  it('detects a c2pa label in a non-pixel PNG chunk but not inside IDAT', () => {
    expect(extractImageMarkers(png(pngChunk('zzZz', 'urn:c2pa:manifest'))).c2pa).toBe(true);
    expect(extractImageMarkers(png(pngChunk('IDAT', 'c2pa'))).c2pa).toBe(false);
  });

  it('detects c2pa / jumb in WebP and ISO-BMFF containers', () => {
    expect(extractImageMarkers(bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'C2PA', [4, 0, 0, 0], 'abcd')).c2pa).toBe(true);
    expect(extractImageMarkers(bytes([0, 0, 0, 24], 'ftypavif', 'mif1', [0, 0, 0, 12], 'jumb')).c2pa).toBe(true);
    expect(extractImageMarkers(bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8 ', 'plain')).c2pa).toBe(false);
  });
});

describe('extractImageMarkers: IPTC DigitalSourceType', () => {
  it.each([
    'trainedAlgorithmicMedia',
    'compositeWithTrainedAlgorithmicMedia',
    'algorithmicMedia',
    'compositeSynthetic',
  ])('reports %s from an XMP attribute in a JPEG', (term) => {
    const markers = extractImageMarkers(jpeg(xmpSegment(digitalSourceTypeXmp(term))));
    expect(markers.iptcDigitalSourceType).toBe(`http://cv.iptc.org/newscodes/digitalsourcetype/${term}`);
  });

  it('reports the element form', () => {
    const xmp = xmpPacket(
      '<rdf:Description><Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia</Iptc4xmpExt:DigitalSourceType></rdf:Description>',
    );
    expect(extractImageMarkers(jpeg(xmpSegment(xmp))).iptcDigitalSourceType).toMatch(/trainedAlgorithmicMedia$/);
  });

  it('reports the rdf:resource form', () => {
    const xmp = xmpPacket(
      '<rdf:Description><Iptc4xmpExt:DigitalSourceType rdf:resource="http://cv.iptc.org/newscodes/digitalsourcetype/compositeSynthetic"/></rdf:Description>',
    );
    expect(extractImageMarkers(jpeg(xmpSegment(xmp))).iptcDigitalSourceType).toMatch(/compositeSynthetic$/);
  });

  it('reads XMP from an uncompressed PNG iTXt chunk', () => {
    const itxt = bytes('XML:com.adobe.xmp\0', [0, 0], '\0', '\0', digitalSourceTypeXmp('trainedAlgorithmicMedia'));
    expect(extractImageMarkers(png(pngChunk('iTXt', itxt))).iptcDigitalSourceType).toMatch(/trainedAlgorithmicMedia$/);
  });

  it('ignores non-AI source types', () => {
    expect(extractImageMarkers(jpeg(xmpSegment(digitalSourceTypeXmp('digitalCapture')))).iptcDigitalSourceType).toBeNull();
  });

  it('ignores AI terms that are not attached to a DigitalSourceType', () => {
    const xmp = xmpPacket('<rdf:Description><dc:description>trainedAlgorithmicMedia is an IPTC term</dc:description></rdf:Description>');
    expect(extractImageMarkers(jpeg(xmpSegment(xmp))).iptcDigitalSourceType).toBeNull();
  });

  it('finds a later AI value when an earlier DigitalSourceType is not AI', () => {
    const xmp = xmpPacket(
      '<a Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture"/>' +
        '<b Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia"/>',
    );
    expect(extractImageMarkers(jpeg(xmpSegment(xmp))).iptcDigitalSourceType).toMatch(/algorithmicMedia$/);
  });
});

describe('extractImageMarkers: AI tool hints', () => {
  it.each([
    ['Midjourney', 'Made with Midjourney v6'],
    ['DALL-E', 'DALL-E 3'],
    ['DALL-E', 'DALL·E 2'],
    ['Stable Diffusion', 'Stable Diffusion XL'],
    ['Stable Diffusion', 'stable-diffusion'],
    ['Adobe Firefly', 'Adobe Firefly'],
    ['Imagen', 'Imagen 3'],
    ['Flux', 'FLUX.1 dev'],
    ['Sora', 'Sora'],
    ['ChatGPT', 'ChatGPT image'],
    ['OpenAI', 'OpenAI'],
  ])('finds %s in XMP (%s)', (hint, creatorTool) => {
    const xmp = xmpPacket(`<rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="${creatorTool}"/>`);
    expect(extractImageMarkers(jpeg(xmpSegment(xmp))).aiToolHints).toContain(hint);
  });

  it('finds hints in PNG tEXt and iTXt chunks', () => {
    expect(extractImageMarkers(png(pngChunk('tEXt', 'Description\0A cat --v 6 Midjourney'))).aiToolHints).toEqual(['Midjourney']);
    const itxt = bytes('Comment\0', [0, 0], 'en\0', '\0', 'generated by DALL-E');
    expect(extractImageMarkers(png(pngChunk('iTXt', itxt))).aiToolHints).toEqual(['DALL-E']);
  });

  it('finds hints in JPEG comments and EXIF Software', () => {
    expect(extractImageMarkers(jpeg(jpegSegment(0xfe, bytes('created with stable diffusion')))).aiToolHints).toEqual(['Stable Diffusion']);
    expect(extractImageMarkers(jpeg(exifSegment('Adobe Firefly 1.0'))).aiToolHints).toEqual(['Adobe Firefly']);
  });

  it('reports several hints once each, in a stable order', () => {
    const markers = extractImageMarkers(jpeg(jpegSegment(0xfe, bytes('openai dall-e midjourney midjourney'))));
    expect(markers.aiToolHints).toEqual(['Midjourney', 'DALL-E', 'OpenAI']);
  });

  it('does not match inside longer words or in compressed pixel data', () => {
    const clean = jpeg(jpegSegment(0xfe, bytes('influx of visitors, Sorbet, imagenes, fireflyers')));
    expect(extractImageMarkers(clean).aiToolHints).toEqual([]);
    expect(extractImageMarkers(png(pngChunk('IDAT', 'Midjourney'))).aiToolHints).toEqual([]);
  });
});

describe('extractImageMarkers: EXIF Software', () => {
  it.each([true, false])('reads a long Software value (little endian: %s)', (little) => {
    const markers = extractImageMarkers(jpeg(exifSegment('Adobe Photoshop 25.0', little)));
    expect(markers.exifSoftware).toBe('Adobe Photoshop 25.0');
    expect(markers.aiToolHints).toEqual([]);
  });

  it('reads a value stored inline in the IFD entry', () => {
    expect(extractImageMarkers(jpeg(exifSegment('AI', true))).exifSoftware).toBe('AI');
  });

  it('reads EXIF from a PNG eXIf chunk', () => {
    const tiff = bytes('MM', [0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x31, 0, 2, 0, 0, 0, 7, 0, 0, 0, 26, 0, 0, 0, 0], 'GIMP 2\0');
    expect(extractImageMarkers(png(pngChunk('eXIf', tiff))).exifSoftware).toBe('GIMP 2');
  });

  it('is null when EXIF has no Software tag or an invalid header', () => {
    expect(extractImageMarkers(jpeg(jpegSegment(0xe1, bytes('Exif\0\0', 'II', [42, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0])))).exifSoftware).toBeNull();
    expect(extractImageMarkers(jpeg(jpegSegment(0xe1, bytes('Exif\0\0', 'XXjunkjunkjunk')))).exifSoftware).toBeNull();
  });

  it('reads Software from a bare TIFF file', () => {
    const tiff = bytes('II', [42, 0, 8, 0, 0, 0, 1, 0, 0x31, 0x01, 2, 0, 7, 0, 0, 0, 26, 0, 0, 0, 0, 0, 0, 0], 'Gimp 2\0');
    expect(extractImageMarkers(tiff).exifSoftware).toBe('Gimp 2');
  });
});

describe('extractImageMarkers: combined', () => {
  it('reports every marker present in one file', () => {
    const file = jpeg(
      exifSegment('Midjourney'),
      xmpSegment(digitalSourceTypeXmp('trainedAlgorithmicMedia')),
      jpegSegment(0xeb, bytes('JP', [0, 1, 0, 0, 0, 1, 0, 0, 0, 16], 'jumb', 'c2pa')),
    );
    expect(extractImageMarkers(file)).toEqual({
      c2pa: true,
      iptcDigitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
      aiToolHints: ['Midjourney'],
      exifSoftware: 'Midjourney',
    });
  });

  it('is deterministic', () => {
    const file = jpeg(exifSegment('DALL-E'), xmpSegment(digitalSourceTypeXmp('compositeSynthetic')));
    expect(extractImageMarkers(file)).toEqual(extractImageMarkers(file));
  });
});
