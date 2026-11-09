import { describe, expect, it } from 'vitest';
import { runRules } from '../../../src/rules/index.js';
import type { Finding, ImageInfo, PageSnapshot } from '../../../src/types.js';
import { image, makeCrawl, makePage, markers } from './helpers.js';

function run(pages: PageSnapshot[]): { media01: Finding; media02: Finding } {
  const findings = runRules(makeCrawl(pages));
  return { media01: findings.find((f) => f.ruleId === 'MEDIA-01')!, media02: findings.find((f) => f.ruleId === 'MEDIA-02')! };
}

const withImages = (...images: ImageInfo[]) => makePage({ images });

describe('MEDIA-01', () => {
  it('found: C2PA manifest, worded as a content-credentials manifest', () => {
    const { media01 } = run([withImages(image({ src: 'https://example.test/c.jpg', markers: markers({ c2pa: true }) }))]);
    expect(media01.outcome).toBe('found');
    expect(media01.needsHumanJudgement).toBe(true);
    expect(media01.evidence[0]).toMatchObject({ kind: 'metadata' });
    expect(media01.evidence[0]?.value).toContain('c2pa=content-credentials manifest present');
    expect(media01.evidence[0]?.value).toContain('https://example.test/c.jpg');
    expect(media01.summary).toMatch(/not that the image is AI-generated/);
  });

  it.each([
    'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
    'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',
    'http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia',
    'compositeSynthetic',
  ])('found: IPTC AI source type %s', (term) => {
    const { media01 } = run([withImages(image({ markers: markers({ iptcDigitalSourceType: term }) }))]);
    expect(media01.outcome).toBe('found');
    expect(media01.evidence[0]?.value).toContain(`iptcDigitalSourceType=${term}`);
  });

  it('found: AI tool hints, with EXIF software included in the evidence', () => {
    const { media01 } = run([withImages(image({ markers: markers({ aiToolHints: ['Midjourney', 'DALL-E'], exifSoftware: 'Adobe Photoshop' }) }))]);
    expect(media01.outcome).toBe('found');
    expect(media01.evidence[0]?.value).toContain('aiToolHints=Midjourney, DALL-E');
    expect(media01.evidence[0]?.value).toContain('exifSoftware=Adobe Photoshop');
  });

  it('does not flag a non-AI IPTC source type or an EXIF Software tag alone', () => {
    const { media01 } = run([
      withImages(
        image({ markers: markers({ iptcDigitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture' }) }),
        image({ src: 'https://example.test/b.jpg', markers: markers({ exifSoftware: 'Midjourney-lookalike editor' }) }),
      ),
    ]);
    expect(media01.outcome).toBe('not_found');
  });

  it('not_found: images read OK without markers; absence is not presented as proof', () => {
    const { media01, media02 } = run([withImages(image(), image({ src: 'https://example.test/b.jpg' }))]);
    expect(media01.outcome).toBe('not_found');
    expect(media01.summary).toMatch(/2 images could be read/);
    expect(media01.summary).toMatch(/does not show that an image is human-made/);
    expect(media01.needsHumanJudgement).toBe(false);
    expect(media01.evidence.map((e) => e.kind)).toEqual(['text']);
    expect(media01.evidence[0]?.value).toMatch(/^Checked https:\/\/example\.test\/: 2 images read for metadata, none with AI-generation markers$/);
    expect(media02.outcome).toBe('cannot_tell');
    expect(media02.reason).toBe('no_flagged_images');
  });

  it('counts a repeated image once', () => {
    const { media01 } = run([withImages(image()), makePage({ url: 'https://example.test/b', images: [image()] })]);
    expect(media01.summary).toMatch(/^1 image could be read/);
  });

  it('cannot_tell/no_images_readable: no images, skipped, errored or unparsed images', () => {
    for (const pages of [
      [makePage()],
      [withImages(image({ fetchStatus: 'skipped', markers: null }))],
      [withImages(image({ fetchStatus: 'error', fetchError: 'timeout', markers: null }))],
      [withImages(image({ fetchStatus: 'ok', markers: null }))],
    ]) {
      const { media01 } = run(pages);
      expect(media01.outcome).toBe('cannot_tell');
      expect(media01.reason).toBe('no_images_readable');
      expect(media01.summary).toMatch(/not a pass/i);
    }
  });

  it('a found image on one page wins over unreadable images elsewhere', () => {
    const { media01 } = run([withImages(image({ fetchStatus: 'error', markers: null })), makePage({ url: 'https://example.test/b', images: [image({ markers: markers({ c2pa: true }) })] })]);
    expect(media01.outcome).toBe('found');
    expect(media01.evidence[0]?.url).toBe('https://example.test/b');
  });

  it('adds the screenshot of the first contributing page and caps evidence at 20', () => {
    const many = Array.from({ length: 30 }, (_, i) => image({ src: `https://example.test/i${i}.jpg`, markers: markers({ c2pa: true }) }));
    const { media01 } = run([makePage({ images: many, screenshot: 'screenshots/page-1.png' })]);
    expect(media01.evidence).toHaveLength(20);
    expect(media01.evidence.at(-1)).toMatchObject({ kind: 'screenshot', value: 'screenshots/page-1.png' });
    expect(media01.summary).toMatch(/capped at 20 items; 11 more matches/);
  });
});

describe('MEDIA-02', () => {
  const flagged = (overrides: Partial<ImageInfo> = {}) => image({ markers: markers({ aiToolHints: ['Midjourney'] }), ...overrides });

  it('found: label in alt text', () => {
    const { media02 } = run([withImages(flagged({ alt: 'A castle (AI-generated)' }))]);
    expect(media02.outcome).toBe('found');
    expect(media02.needsHumanJudgement).toBe(true);
    expect(media02.evidence[0]?.value).toContain('alt text');
  });

  it('found: label in nearby text', () => {
    const { media02 } = run([withImages(flagged({ nearbyText: 'Image created with AI for this article' }))]);
    expect(media02.outcome).toBe('found');
    expect(media02.evidence[0]?.value).toContain('nearby text');
  });

  it.each([
    'Bild KI-generiert',
    'Image générée par IA',
    'Imagen GENERADA POR IA',
    "Immagine generata dall'IA",
    'Afbeelding door AI gemaakt',
    'Imagem gerada por IA',
    'Grafika wygenerowana przez AI',
    'Photo by Midjourney',
    'An AI image of a cat',
  ])('found: multi-language label "%s"', (nearbyText) => {
    const { media02 } = run([withImages(flagged({ nearbyText }))]);
    expect(media02.outcome).toBe('found');
  });

  it('is accent-insensitive', () => {
    expect(run([withImages(flagged({ nearbyText: 'Image generee par IA' }))]).media02.outcome).toBe('found');
  });

  it('not_found: flagged image without label, evidence lists it', () => {
    const { media02 } = run([withImages(flagged({ src: 'https://example.test/x.jpg', alt: 'A castle', nearbyText: 'Our new product line' }))]);
    expect(media02.outcome).toBe('not_found');
    expect(media02.needsHumanJudgement).toBe(true);
    expect(media02.evidence[0]).toMatchObject({ kind: 'element' });
    expect(media02.evidence[0]?.value).toContain('https://example.test/x.jpg');
    expect(media02.summary).toMatch(/1 of 1 flagged image has no AI-label wording/);
  });

  it('mixed: not_found, with the labelled image in the summary and evidence', () => {
    const { media02 } = run([
      withImages(
        flagged({ src: 'https://example.test/a.jpg', alt: 'AI-generated sunset' }),
        flagged({ src: 'https://example.test/b.jpg', alt: 'Plain' }),
        flagged({ src: 'https://example.test/c.jpg', alt: 'Also plain' }),
      ),
    ]);
    expect(media02.outcome).toBe('not_found');
    expect(media02.summary).toMatch(/2 of 3 flagged images have no AI-label wording/);
    expect(media02.summary).toMatch(/1 other has such wording/);
    expect(media02.evidence.map((e) => e.kind)).toEqual(['element', 'element', 'text']);
  });

  it('does not count an unflagged image label or an unrelated "bot" word as a label', () => {
    const { media02 } = run([withImages(flagged({ alt: 'Robotics lab', nearbyText: 'abbot bottle' }))]);
    expect(media02.outcome).toBe('not_found');
  });

  it('cannot_tell/no_flagged_images when MEDIA-01 is not found', () => {
    const { media02 } = run([withImages(image({ alt: 'AI-generated but no metadata' }))]);
    expect(media02.outcome).toBe('cannot_tell');
    expect(media02.reason).toBe('no_flagged_images');
    expect(media02.summary).toMatch(/Nothing to check/);
  });

  it('evaluates the same image separately per page', () => {
    const { media02 } = run([
      withImages(flagged({ alt: 'AI-generated' })),
      makePage({ url: 'https://example.test/b', images: [flagged({ alt: 'no label here' })] }),
    ]);
    expect(media02.outcome).toBe('not_found');
    expect(media02.evidence[0]?.url).toBe('https://example.test/b');
    expect(media02.pagesEvaluated).toEqual(['https://example.test/', 'https://example.test/b']);
  });
});
