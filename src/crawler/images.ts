import type { ImageInfo } from '../types.js';
import { detectImageFormat, extractImageMarkers } from '../metadata/markers.js';
import { errorMessage, readLimited, safeFetch } from './net.js';

const IMAGE_TIMEOUT_MS = 8000;
const MIN_SIDE_PX = 48;

export interface ImageInspectionOptions {
  maxImages: number;
  maxBytes: number;
  allowPrivate: boolean;
  userAgent: string;
  /** Returns false when robots.txt forbids fetching this URL (only consulted for the crawled site). */
  robotsAllows: (url: string) => Promise<boolean>;
}

function isTiny(image: ImageInfo): boolean {
  return image.width !== null && image.height !== null && Math.max(image.width, image.height) < MIN_SIDE_PX;
}

function looksLikeSvg(image: ImageInfo): boolean {
  try {
    return new URL(image.src).pathname.toLowerCase().endsWith('.svg');
  } catch {
    return false;
  }
}

/**
 * Reads the first bytes of up to `maxImages` of the larger images and extracts metadata markers.
 * Raw bytes are never kept. Returns a new array in the original order; failures are recorded per image.
 */
export async function inspectImages(images: ImageInfo[], opts: ImageInspectionOptions): Promise<ImageInfo[]> {
  const chosen = new Set(
    images
      .map((image, index) => ({ image, index, area: (image.width ?? 0) * (image.height ?? 0) }))
      .filter(({ image }) => !isTiny(image) && !looksLikeSvg(image))
      .sort((a, b) => b.area - a.area || a.index - b.index)
      .slice(0, Math.max(0, opts.maxImages))
      .map(({ index }) => index),
  );

  const result: ImageInfo[] = [];
  for (const [index, image] of images.entries()) {
    result.push(chosen.has(index) ? await inspectOne(image, opts) : { ...image, fetchStatus: 'skipped', markers: null });
  }
  return result;
}

async function inspectOne(image: ImageInfo, opts: ImageInspectionOptions): Promise<ImageInfo> {
  if (!(await opts.robotsAllows(image.src))) {
    return { ...image, fetchStatus: 'skipped', fetchError: 'robots_disallow', markers: null };
  }
  const fetched = await safeFetch(image.src, {
    headers: { 'user-agent': opts.userAgent, accept: 'image/*,*/*;q=0.5', range: `bytes=0-${opts.maxBytes - 1}` },
    timeoutMs: IMAGE_TIMEOUT_MS,
    allowPrivate: opts.allowPrivate,
  });
  if (!fetched.ok) return { ...image, fetchStatus: 'error', fetchError: fetched.error, markers: null };

  const { response } = fetched;
  const contentType = response.headers.get('content-type');
  if (response.status !== 200 && response.status !== 206) {
    await response.body?.cancel().catch(() => undefined);
    return { ...image, fetchStatus: 'error', fetchError: `http_${response.status}`, contentType, markers: null };
  }
  if (contentType && /svg/i.test(contentType)) {
    await response.body?.cancel().catch(() => undefined);
    return { ...image, fetchStatus: 'skipped', contentType, markers: null };
  }
  try {
    const bytes = await readLimited(response, opts.maxBytes);
    if (detectImageFormat(bytes) === 'other') {
      return { ...image, fetchStatus: 'skipped', contentType, bytesRead: bytes.length, markers: null };
    }
    return { ...image, fetchStatus: 'ok', contentType, bytesRead: bytes.length, markers: extractImageMarkers(bytes) };
  } catch (err) {
    return { ...image, fetchStatus: 'error', fetchError: errorMessage(err), contentType, markers: null };
  }
}
