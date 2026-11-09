import type { Evidence, ExplanationBlock, Finding, Outcome, Report, RuleMeta } from '../types.js';
import { escapeHtml as e } from '../util/escape.js';

const OUTCOME_LABEL: Record<Outcome, string> = {
  found: 'Found',
  not_found: 'Not found',
  cannot_tell: 'Cannot tell (not a pass)',
};

const SKIPPED_ROWS_SHOWN = 50;

const CSS = `
:root{color-scheme:light;--fg:#1b1f24;--muted:#4a5560;--line:#c9d1d9;--bg:#fff;--panel:#f6f8fa;
--found:#0b4f9c;--found-bg:#e8f1fb;--nf:#2d3640;--nf-bg:#eef0f2;--ct:#6b3f00;--ct-bg:#fff3cf}
*{box-sizing:border-box}
body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);background:var(--bg)}
.wrap{max-width:60rem;margin:0 auto;padding:1rem 1rem 3rem}
h1{font-size:1.6rem;margin:.5rem 0}h2{font-size:1.25rem;margin:2rem 0 .5rem;border-bottom:1px solid var(--line);padding-bottom:.25rem}
h3{font-size:1.05rem;margin:0 0 .5rem}
a{color:var(--found)}a:focus-visible,summary:focus-visible{outline:3px solid #f5a623;outline-offset:2px}
.skip{position:absolute;left:-999px}.skip:focus{left:1rem;top:1rem;background:#fff;padding:.5rem;z-index:2}
.disclaimer{border:2px solid var(--ct);background:var(--ct-bg);padding:.75rem 1rem;border-radius:6px;margin:1rem 0}
.disclaimer strong{display:block;margin-bottom:.25rem}
.counts{display:flex;flex-wrap:wrap;gap:.5rem;list-style:none;padding:0;margin:.5rem 0}
.counts li{border:1px solid var(--line);border-radius:6px;padding:.4rem .75rem;background:var(--panel)}
.finding{border:1px solid var(--line);border-left-width:8px;border-radius:6px;padding:.75rem 1rem;margin:1rem 0;background:var(--panel)}
.finding.found{border-left-color:var(--found)}.finding.not_found{border-left-color:var(--nf)}
.finding.cannot_tell{border-left-color:var(--ct);border-left-style:dashed}
.badge{display:inline-block;font-weight:700;padding:.1rem .6rem;border-radius:4px;border:1px solid currentColor}
.badge.found{color:var(--found);background:var(--found-bg)}.badge.not_found{color:var(--nf);background:var(--nf-bg)}
.badge.cannot_tell{color:var(--ct);background:var(--ct-bg);border-style:dashed}
table{border-collapse:collapse;width:100%;margin:.5rem 0;font-size:.9rem;background:var(--bg)}
caption{text-align:left;font-weight:600;padding:.25rem 0}
th,td{border:1px solid var(--line);padding:.35rem .5rem;text-align:left;vertical-align:top}
th{background:var(--panel)}
code{font:.85rem ui-monospace,Menlo,Consolas,monospace;overflow-wrap:anywhere;word-break:break-word}
td{overflow-wrap:anywhere}
.shot{max-width:240px;height:auto;border:1px solid var(--line);display:block}
.muted{color:var(--muted)}.pages li{margin:.5rem 0}
dt{font-weight:600;margin-top:.5rem}dd{margin:0 0 .25rem}
@media print{.skip{display:none}.finding{break-inside:avoid}a{color:inherit}}
`;

/** Only absolute http(s) URLs become links. Anything else (javascript:, data:, ...) is shown as plain text. */
function httpHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Screenshots must be plain relative paths inside the report directory. */
function relativeImagePath(path: string | null): string | null {
  if (path === null) return null;
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/.test(path) ? path : null;
}

function urlHtml(url: string): string {
  const href = httpHref(url);
  return href === null ? `<code>${e(url)}</code>` : `<a href="${e(href)}" rel="noopener noreferrer">${e(url)}</a>`;
}

function thumbnailHtml(path: string, alt: string): string {
  const p = e(path);
  return `<a href="${p}"><img class="shot" src="${p}" alt="${e(alt)}" loading="lazy"></a>`;
}

function time(iso: string): string {
  return `<time datetime="${e(iso)}">${e(iso)}</time>`;
}

function disclaimerHtml(report: Report, label: string): string {
  return `<aside class="disclaimer" role="note" aria-label="${e(label)}"><strong>Not legal advice</strong><p>${e(report.disclaimer)}</p></aside>`;
}

function evidenceRow(ev: Evidence): string {
  const path = ev.kind === 'screenshot' ? relativeImagePath(ev.value) : null;
  const value =
    path === null
      ? `<code>${e(ev.value)}</code>`
      : `${thumbnailHtml(path, `Screenshot captured from ${ev.url}`)}<code>${e(ev.value)}</code>`;
  return `<tr><td>${e(ev.kind)}</td><td>${value}</td><td>${urlHtml(ev.url)}</td><td>${time(ev.capturedAt)}</td></tr>`;
}

function evidenceTable(f: Finding): string {
  if (f.evidence.length === 0) return '<p class="muted">No evidence items were recorded for this finding.</p>';
  return `<table><caption>Evidence for ${e(f.ruleId)} (${f.evidence.length} item${f.evidence.length === 1 ? '' : 's'})</caption>
<thead><tr><th scope="col">Kind</th><th scope="col">Value</th><th scope="col">Page</th><th scope="col">Captured</th></tr></thead>
<tbody>${f.evidence.map(evidenceRow).join('\n')}</tbody></table>`;
}

function findingHtml(f: Finding, index: number): string {
  const headingId = `finding-${index + 1}`;
  const pages =
    f.pagesEvaluated.length === 0
      ? 'none'
      : f.pagesEvaluated.map((u) => urlHtml(u)).join(', ');
  return `<article class="finding ${f.outcome}" aria-labelledby="${headingId}">
<h3 id="${headingId}">${e(f.ruleId)}: ${e(f.title)}</h3>
<p><span class="badge ${f.outcome}">${e(OUTCOME_LABEL[f.outcome])}</span></p>
<p>${e(f.summary)}</p>
${f.reason === undefined ? '' : `<p class="muted">Reason code: <code>${e(f.reason)}</code></p>`}
${f.needsHumanJudgement ? '<p><strong>Needs human judgement:</strong> this scan cannot assess whether the wording, label or placement is adequate.</p>' : ''}
<p class="muted">Pages evaluated: ${pages}</p>
${evidenceTable(f)}
</article>`;
}

function pagesHtml(report: Report): string {
  const { scope } = report;
  const pages =
    scope.pagesChecked.length === 0
      ? '<p><strong>No pages were loaded.</strong></p>'
      : `<ol class="pages">${scope.pagesChecked
          .map((p) => {
            const shot = relativeImagePath(p.screenshot);
            return `<li>${urlHtml(p.finalUrl)} <span class="muted">(requested ${e(p.url)}; HTTP status ${p.status === null ? 'none' : e(String(p.status))}; fetched ${time(p.fetchedAt)})</span>${
              shot === null ? '' : thumbnailHtml(shot, `Screenshot of ${p.finalUrl}`)
            }</li>`;
          })
          .join('\n')}</ol>`;
  const shown = scope.skipped.slice(0, SKIPPED_ROWS_SHOWN);
  const skipped =
    shown.length === 0
      ? ''
      : `<table><caption>URLs not visited (${scope.skipped.length})</caption>
<thead><tr><th scope="col">URL</th><th scope="col">Reason</th><th scope="col">Detail</th></tr></thead>
<tbody>${shown.map((s) => `<tr><td><code>${e(s.url)}</code></td><td>${e(s.reason)}</td><td>${s.detail === undefined ? '' : e(s.detail)}</td></tr>`).join('\n')}</tbody></table>${
          scope.skipped.length > shown.length ? `<p class="muted">${scope.skipped.length - shown.length} more not shown; see report.json.</p>` : ''
        }`;
  const robots = scope.robots;
  return `<section aria-labelledby="pages"><h2 id="pages">Pages checked</h2>
<p>Up to ${scope.pagesRequested} pages were requested; ${scope.pagesChecked.length} loaded.${scope.startBlocked === null ? '' : ` The scan was blocked at the start page (<code>${e(scope.startBlocked)}</code>).`}</p>
${pages}
<p class="muted">robots.txt: ${urlHtml(robots.url)}, ${robots.fetched ? 'retrieved' : 'not retrieved'}${robots.status === null ? '' : ` (HTTP ${e(String(robots.status))})`}${robots.crawlDelaySeconds === null ? '' : `, Crawl-delay ${e(String(robots.crawlDelaySeconds))}s`}. User-Agent: <code>${e(scope.userAgent)}</code></p>
${skipped}</section>`;
}

function explanationHtml(x: ExplanationBlock | undefined, findings: Finding[]): string {
  if (x === undefined) return '';
  const source = x.source === 'template' ? 'deterministic template (no model used)' : `model provider ${x.source}${x.model === undefined ? '' : `, model ${x.model}`}`;
  const titles = new Map(findings.map((f) => [f.ruleId, f.title]));
  return `<section aria-labelledby="explanation"><h2 id="explanation">Plain-language explanation</h2>
<p class="muted">Source: ${e(source)}. This text only explains the findings above; it cannot add, remove or change any of them.${
    x.guardRejected === undefined ? '' : ` Model output was not used (reason: <code>${e(x.guardRejected)}</code>); the template text is shown instead.`
  }</p>
<dl>${x.items.map((i) => `<dt>${e(i.ruleId)}${titles.has(i.ruleId) ? `: ${e(titles.get(i.ruleId) ?? '')}` : ''}</dt><dd>${e(i.text)}</dd>`).join('\n')}</dl></section>`;
}

function catalogHtml(catalog: RuleMeta[]): string {
  return `<section aria-labelledby="catalog"><h2 id="catalog">Rule catalog</h2>
<dl>${catalog
    .map(
      (r) =>
        `<dt>${e(r.ruleId)}: ${e(r.title)}</dt><dd>${e(r.description)}<br><span class="muted">Limitations: ${e(r.limitations)}</span><br><span class="muted">Legal note (unverified, not legal advice): ${e(r.legalNote)}</span></dd>`,
    )
    .join('\n')}</dl></section>`;
}

/** Renders one self-contained HTML file: inline CSS, no scripts, no external requests. Every dynamic string is escaped. */
export function renderHtml(report: Report): string {
  const { summary } = report;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${e(`AI Act transparency check: ${report.target.host}`)}</title>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#findings">Skip to findings</a>
<div class="wrap">
<header>
<h1>AI Act transparency check</h1>
<p>Target: ${urlHtml(report.target.startUrl)}<br><span class="muted">Generated ${time(report.generatedAt)} by ${e(report.tool.name)} ${e(report.tool.version)}, rules ${e(report.rulesVersion)}</span></p>
${disclaimerHtml(report, 'Disclaimer (top)')}
</header>
<main>
<section aria-labelledby="summary"><h2 id="summary">Summary</h2>
<ul class="counts"><li><strong>${summary.found}</strong> found</li><li><strong>${summary.not_found}</strong> not found</li><li><strong>${summary.cannot_tell}</strong> cannot tell (not a pass)</li></ul>
<p class="muted">"Found" and "Not found" describe what the fixed rules saw on the pages checked; neither is a verdict. "Cannot tell" means the scan could not determine the answer.</p>
</section>
${pagesHtml(report)}
<section aria-labelledby="findings"><h2 id="findings">Findings</h2>
${report.findings.map(findingHtml).join('\n')}
</section>
${explanationHtml(report.explanation, report.findings)}
<section aria-labelledby="limitations"><h2 id="limitations">What this scan cannot see</h2>
<ul>${report.limitations.map((l) => `<li>${e(l)}</li>`).join('\n')}</ul></section>
${catalogHtml(report.ruleCatalog)}
</main>
<footer>
${disclaimerHtml(report, 'Disclaimer (bottom)')}
</footer>
</div>
</body>
</html>
`;
}
