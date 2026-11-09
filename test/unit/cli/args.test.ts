import { describe, expect, it } from 'vitest';
import { UsageError, defaultOutDir, parseCliArgs } from '../../../src/util/args.js';

const URL_ARG = 'http://127.0.0.1:8080/';

function scanOf(argv: string[]) {
  const parsed = parseCliArgs(argv);
  if (parsed.kind !== 'scan') throw new Error('expected a scan');
  return parsed;
}

describe('parseCliArgs', () => {
  it('applies defaults', () => {
    expect(scanOf([URL_ARG])).toEqual({
      kind: 'scan',
      url: URL_ARG,
      options: { pages: 10, out: null, json: false, explain: false, delayMs: null, timeoutMs: null, settleMs: null, allowPrivate: false, html: true },
    });
  });

  it('parses every flag', () => {
    const { options } = scanOf([
      URL_ARG, '--pages', '5', '--out', 'some/dir', '--json', '--explain', '--delay-ms', '0', '--timeout-ms', '5000', '--settle-ms', '100', '--allow-private', '--no-html',
    ]);
    expect(options).toEqual({ pages: 5, out: 'some/dir', json: true, explain: true, delayMs: 0, timeoutMs: 5000, settleMs: 100, allowPrivate: true, html: false });
  });

  it('accepts flags before the url and --flag=value syntax', () => {
    const parsed = scanOf(['--pages=3', URL_ARG, '--out=x']);
    expect(parsed.url).toBe(URL_ARG);
    expect(parsed.options.pages).toBe(3);
    expect(parsed.options.out).toBe('x');
  });

  it('recognises help and version, taking priority over a missing url', () => {
    expect(parseCliArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseCliArgs(['-h'])).toEqual({ kind: 'help' });
    expect(parseCliArgs(['--version'])).toEqual({ kind: 'version' });
    expect(parseCliArgs([URL_ARG, '--version'])).toEqual({ kind: 'version' });
  });

  it.each([
    ['pages', '1', 1],
    ['pages', '25', 25],
    ['delay-ms', '0', 0],
    ['delay-ms', '60000', 60000],
    ['timeout-ms', '1000', 1000],
    ['timeout-ms', '120000', 120000],
    ['settle-ms', '0', 0],
    ['settle-ms', '30000', 30000],
  ])('accepts the boundary --%s %s', (flag, value, expected) => {
    const { options } = scanOf([URL_ARG, `--${flag}`, value]);
    const key = { pages: 'pages', 'delay-ms': 'delayMs', 'timeout-ms': 'timeoutMs', 'settle-ms': 'settleMs' }[flag] as keyof typeof options;
    expect(options[key]).toBe(expected);
  });

  it.each([
    ['pages', '0'],
    ['pages', '26'],
    ['pages', '-1'],
    ['pages', '1.5'],
    ['pages', 'abc'],
    ['pages', ''],
    ['pages', '1e3'],
    ['pages', '0x10'],
    ['pages', '99999999999'],
    ['delay-ms', '60001'],
    ['delay-ms', '-5'],
    ['timeout-ms', '999'],
    ['timeout-ms', '120001'],
    ['settle-ms', '30001'],
    ['settle-ms', 'NaN'],
  ])('rejects --%s %j', (flag, value) => {
    expect(() => parseCliArgs([URL_ARG, `--${flag}=${value}`])).toThrow(UsageError);
  });

  it('rejects a flag with no value', () => {
    expect(() => parseCliArgs([URL_ARG, '--pages'])).toThrow(UsageError);
    expect(() => parseCliArgs([URL_ARG, '--out'])).toThrow(UsageError);
  });

  it('rejects an empty --out', () => {
    expect(() => parseCliArgs([URL_ARG, '--out', '  '])).toThrow(UsageError);
  });

  it('rejects unknown options, a missing url, and extra positionals', () => {
    expect(() => parseCliArgs([URL_ARG, '--nope'])).toThrow(UsageError);
    expect(() => parseCliArgs([URL_ARG, '--ignore-robots'])).toThrow(UsageError);
    expect(() => parseCliArgs([URL_ARG, '-x'])).toThrow(UsageError);
    expect(() => parseCliArgs([])).toThrow(/missing <url>/);
    expect(() => parseCliArgs(['--json'])).toThrow(UsageError);
    expect(() => parseCliArgs([URL_ARG, 'http://127.0.0.1:2/'])).toThrow(/exactly one/);
  });

  it('does not accept a flag that offers no way around robots.txt', () => {
    expect(() => parseCliArgs([URL_ARG, '--no-robots'])).toThrow(UsageError);
  });
});

describe('defaultOutDir', () => {
  const when = new Date('2026-03-04T05:06:07.890Z');

  it('uses host and a UTC timestamp', () => {
    expect(defaultOutDir('example.com', when)).toBe('./ai-act-check-report-example.com-20260304T050607');
  });

  it('makes hosts with ports and odd characters filename-safe', () => {
    expect(defaultOutDir('127.0.0.1:8080', when)).toBe('./ai-act-check-report-127.0.0.1-8080-20260304T050607');
    expect(defaultOutDir('../Évil/host', when)).toBe('./ai-act-check-report-vil-host-20260304T050607');
    expect(defaultOutDir('', when)).toBe('./ai-act-check-report-site-20260304T050607');
  });
});
