import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inspectImages, type ImageInspectionOptions } from '../../../src/crawler/images.js';
import type { ImageInfo } from '../../../src/types.js';
import { bytes, digitalSourceTypeXmp, exifSegment, jpeg, jpegSegment, png, pngChunk, xmpSegment } from '../metadata/builders.js';
import { startServer, type TestServer } from './server.js';

const aiJpeg = jpeg(exifSegment('Midjourney'), xmpSegment(digitalSourceTypeXmp('trainedAlgorithmicMedia')), jpegSegment(0xeb, bytes('JP', [0, 1, 0, 0, 0, 1, 0, 0, 0, 16], 'jumb', 'c2pa')));
const plainPng = png(pngChunk('tEXt', 'Comment\0hello'));

describe('inspectImages', () => {
  let server: TestServer;
  const img = (path: string, extra: Partial<ImageInfo> = {}): ImageInfo => ({
    src: `${server.origin}${path}`,
    alt: '',
    width: 400,
    height: 300,
    nearbyText: '',
    fetchStatus: 'skipped',
    markers: null,
    ...extra,
  });
  const options = (extra: Partial<ImageInspectionOptions> = {}): ImageInspectionOptions => ({
    maxImages: 10,
    maxBytes: 4096,
    allowPrivate: true,
    userAgent: 'ai-act-check/test',
    robotsAllows: async () => true,
    ...extra,
  });

  beforeAll(async () => {
    server = await startServer({
      '/ai.jpg': (req) => {
        const range = req.headers.range;
        // A server that ignores Range answers 200 with everything; one that honours it answers 206.
        return range && req.url?.includes('partial')
          ? { status: 206, headers: { 'content-type': 'image/jpeg' }, body: aiJpeg }
          : { status: 200, headers: { 'content-type': 'image/jpeg' }, body: aiJpeg };
      },
      '/plain.png': { status: 200, headers: { 'content-type': 'image/png' }, body: plainPng },
      '/vector.svg': { status: 200, headers: { 'content-type': 'image/svg+xml' }, body: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
      '/disguised': { status: 200, headers: { 'content-type': 'image/svg+xml' }, body: aiJpeg },
      '/not-an-image': { status: 200, headers: { 'content-type': 'image/gif' }, body: 'GIF89a....' },
      '/gone.jpg': { status: 404, body: 'nope' },
      '/huge.jpg': { status: 200, headers: { 'content-type': 'image/jpeg' }, body: bytes(jpeg(), new Uint8Array(2_000_000)) },
    });
  });
  afterAll(async () => {
    await server.close();
  });

  it('extracts markers from fetched images and keeps no raw bytes', async () => {
    const [result] = await inspectImages([img('/ai.jpg')], options());
    expect(result).toMatchObject({
      fetchStatus: 'ok',
      contentType: 'image/jpeg',
      bytesRead: aiJpeg.length,
      markers: { c2pa: true, exifSoftware: 'Midjourney', aiToolHints: ['Midjourney'] },
    });
    expect(result?.markers?.iptcDigitalSourceType).toMatch(/trainedAlgorithmicMedia$/);
    expect(JSON.stringify(result)).not.toContain('compressed-data');
    const request = server.requests.find((r) => r.url === '/ai.jpg');
    expect(request?.headers.range).toBe('bytes=0-4095');
    expect(request?.headers['user-agent']).toBe('ai-act-check/test');
  });

  it('accepts 206 responses', async () => {
    const [result] = await inspectImages([img('/ai.jpg?partial=1')], options());
    expect(result?.fetchStatus).toBe('ok');
  });

  it('truncates to maxBytes when the server ignores Range', async () => {
    const [result] = await inspectImages([img('/huge.jpg')], options({ maxBytes: 2048 }));
    expect(result?.fetchStatus).toBe('ok');
    expect(result?.bytesRead).toBe(2048);
  });

  it('reports clean images with empty markers (not null)', async () => {
    const [result] = await inspectImages([img('/plain.png')], options());
    expect(result?.fetchStatus).toBe('ok');
    expect(result?.markers).toEqual({ c2pa: false, iptcDigitalSourceType: null, aiToolHints: [], exifSoftware: null });
  });

  it('skips SVG by extension and content type without fetching it', async () => {
    const before = server.requests.length;
    const [byExtension] = await inspectImages([img('/vector.svg')], options());
    expect(byExtension).toMatchObject({ fetchStatus: 'skipped', markers: null });
    expect(server.requests.length).toBe(before);
    const [byType] = await inspectImages([img('/disguised')], options());
    expect(byType).toMatchObject({ fetchStatus: 'skipped', markers: null, contentType: 'image/svg+xml' });
  });

  it('skips bytes in a format without a parser', async () => {
    const [result] = await inspectImages([img('/not-an-image')], options());
    expect(result).toMatchObject({ fetchStatus: 'skipped', markers: null });
  });

  it('records HTTP errors per image', async () => {
    const [result] = await inspectImages([img('/gone.jpg')], options());
    expect(result).toMatchObject({ fetchStatus: 'error', fetchError: 'http_404', markers: null });
  });

  it('refuses private hosts when allowPrivate is false', async () => {
    const before = server.requests.length;
    const [result] = await inspectImages([img('/ai.jpg')], options({ allowPrivate: false }));
    expect(result).toMatchObject({ fetchStatus: 'error', fetchError: 'private_address', markers: null });
    expect(server.requests.length).toBe(before);
  });

  it('respects robots.txt for disallowed images', async () => {
    const before = server.requests.length;
    const [result] = await inspectImages([img('/ai.jpg')], options({ robotsAllows: async () => false }));
    expect(result).toMatchObject({ fetchStatus: 'skipped', fetchError: 'robots_disallow', markers: null });
    expect(server.requests.length).toBe(before);
  });

  it('inspects only the largest maxImages images and keeps document order', async () => {
    const images = [
      img('/plain.png', { width: 100, height: 100 }),
      img('/ai.jpg', { width: 1000, height: 800 }),
      img('/gone.jpg', { width: 500, height: 500 }),
      img('/plain.png?second', { width: 200, height: 200 }),
    ];
    const results = await inspectImages(images, options({ maxImages: 2 }));
    expect(results.map((r) => r.src)).toEqual(images.map((i) => i.src));
    expect(results.map((r) => r.fetchStatus)).toEqual(['skipped', 'ok', 'error', 'skipped']);
  });

  it('skips tiny images such as tracking pixels but not images of unknown size', async () => {
    const results = await inspectImages([img('/plain.png?tiny', { width: 1, height: 1 }), img('/plain.png?unknown', { width: null, height: null })], options());
    expect(results.map((r) => r.fetchStatus)).toEqual(['skipped', 'ok']);
  });

  it('does nothing when maxImages is 0', async () => {
    const before = server.requests.length;
    const results = await inspectImages([img('/ai.jpg')], options({ maxImages: 0 }));
    expect(results[0]?.fetchStatus).toBe('skipped');
    expect(server.requests.length).toBe(before);
  });
});
