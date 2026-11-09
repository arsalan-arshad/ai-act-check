// Hand-rolled validator for report.json (schemaVersion 1), written from src/types.ts only.
// Returns a list of human-readable problems; an empty list means the shape is valid.
const OUTCOMES = ['found', 'not_found', 'cannot_tell'];
const EVIDENCE_KINDS = ['text', 'script', 'metadata', 'screenshot', 'link', 'element'];
const SKIP_REASONS = ['robots_disallow', 'off_site', 'max_pages', 'non_html', 'load_failed', 'private_address', 'invalid_url', 'duplicate'];
const START_BLOCKED = [null, 'robots_disallow', 'private_address', 'invalid_url', 'load_failed'];
export const RULE_ORDER = ['CHAT-01', 'CHAT-02', 'MEDIA-01', 'MEDIA-02', 'PAGE-01'];

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNonEmptyStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
export const isIso = (v: unknown): boolean =>
  isStr(v) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v));

export function validateReport(input: unknown): string[] {
  const errs: string[] = [];
  const err = (m: string): void => {
    errs.push(m);
  };
  if (!isObj(input)) return ['report is not an object'];
  const r = input;

  if (r.schemaVersion !== 1) err(`schemaVersion must be 1, got ${String(r.schemaVersion)}`);
  if (!isObj(r.tool) || r.tool.name !== 'ai-act-check' || !isNonEmptyStr(r.tool.version)) err('tool must be {name:"ai-act-check", version:string}');
  if (!isNonEmptyStr(r.rulesVersion)) err('rulesVersion missing');
  if (!isIso(r.generatedAt)) err('generatedAt must be an ISO timestamp');
  if (!isObj(r.target) || !isNonEmptyStr(r.target.startUrl) || !isStr(r.target.host)) err('target must be {startUrl, host}');

  if (!isObj(r.scope)) {
    err('scope missing');
  } else {
    const s = r.scope;
    if (!isNonEmptyStr(s.userAgent)) err('scope.userAgent missing');
    if (typeof s.pagesRequested !== 'number') err('scope.pagesRequested must be a number');
    if (!Array.isArray(s.pagesChecked)) err('scope.pagesChecked must be an array');
    else
      s.pagesChecked.forEach((p, i) => {
        if (!isObj(p)) return err(`pagesChecked[${i}] not an object`);
        if (!isNonEmptyStr(p.url) || !isNonEmptyStr(p.finalUrl)) err(`pagesChecked[${i}] url/finalUrl missing`);
        if (!(p.status === null || typeof p.status === 'number')) err(`pagesChecked[${i}].status must be number|null`);
        if (!(p.screenshot === null || isNonEmptyStr(p.screenshot))) err(`pagesChecked[${i}].screenshot must be string|null`);
        if (!isIso(p.fetchedAt)) err(`pagesChecked[${i}].fetchedAt must be ISO`);
      });
    if (!Array.isArray(s.skipped)) err('scope.skipped must be an array');
    else
      s.skipped.forEach((k, i) => {
        if (!isObj(k) || !isNonEmptyStr(k.url) || !SKIP_REASONS.includes(String(k.reason))) err(`skipped[${i}] invalid`);
      });
    if (!isObj(s.robots)) err('scope.robots missing');
    else {
      if (!isStr(s.robots.url)) err('robots.url must be string');
      if (typeof s.robots.fetched !== 'boolean') err('robots.fetched must be boolean');
      if (!(s.robots.status === null || typeof s.robots.status === 'number')) err('robots.status must be number|null');
      if (!(s.robots.crawlDelaySeconds === null || typeof s.robots.crawlDelaySeconds === 'number')) err('robots.crawlDelaySeconds must be number|null');
    }
    if (!START_BLOCKED.includes(s.startBlocked as string | null)) err(`scope.startBlocked invalid: ${String(s.startBlocked)}`);
  }

  const findings = Array.isArray(r.findings) ? r.findings : null;
  if (!findings) err('findings must be an array');
  else {
    findings.forEach((f, i) => {
      if (!isObj(f)) return err(`findings[${i}] not an object`);
      const id = String(f.ruleId);
      if (!isNonEmptyStr(f.ruleId)) err(`findings[${i}].ruleId missing`);
      if (!isNonEmptyStr(f.title)) err(`${id}: title missing`);
      if (!OUTCOMES.includes(String(f.outcome))) err(`${id}: outcome must be one of ${OUTCOMES.join('/')}, got ${String(f.outcome)}`);
      if (typeof f.needsHumanJudgement !== 'boolean') err(`${id}: needsHumanJudgement must be boolean`);
      if (!isNonEmptyStr(f.summary)) err(`${id}: summary missing`);
      if (!(f.reason === undefined || isNonEmptyStr(f.reason))) err(`${id}: reason must be a non-empty string when present`);
      if (!Array.isArray(f.pagesEvaluated) || !f.pagesEvaluated.every(isStr)) err(`${id}: pagesEvaluated must be string[]`);
      if (!Array.isArray(f.evidence)) err(`${id}: evidence must be an array`);
      else {
        if (f.evidence.length > 20) err(`${id}: evidence exceeds the cap of 20 (${f.evidence.length})`);
        f.evidence.forEach((e, j) => {
          if (!isObj(e)) return err(`${id}.evidence[${j}] not an object`);
          if (!isNonEmptyStr(e.url)) err(`${id}.evidence[${j}].url missing`);
          if (!EVIDENCE_KINDS.includes(String(e.kind))) err(`${id}.evidence[${j}].kind invalid: ${String(e.kind)}`);
          if (!isNonEmptyStr(e.value)) err(`${id}.evidence[${j}].value missing`);
          if (!isIso(e.capturedAt)) err(`${id}.evidence[${j}].capturedAt must be ISO`);
        });
      }
      if (f.outcome === 'cannot_tell' && !isNonEmptyStr(f.reason)) err(`${id}: cannot_tell must carry a reason code`);
    });
    const ids = findings.map((f) => (isObj(f) ? String(f.ruleId) : '?'));
    if (JSON.stringify(ids) !== JSON.stringify(RULE_ORDER)) err(`findings order must be ${RULE_ORDER.join(',')}, got ${ids.join(',')}`);
    if (isObj(r.summary)) {
      const count = (o: string): number => findings.filter((f) => isObj(f) && f.outcome === o).length;
      for (const o of OUTCOMES) if (r.summary[o] !== count(o)) err(`summary.${o}=${String(r.summary[o])} but findings have ${count(o)}`);
    } else err('summary missing');
  }

  if (!Array.isArray(r.ruleCatalog) || r.ruleCatalog.length !== RULE_ORDER.length) err('ruleCatalog must list all 5 rules');
  else
    r.ruleCatalog.forEach((m, i) => {
      if (!isObj(m)) return err(`ruleCatalog[${i}] not an object`);
      for (const k of ['ruleId', 'title', 'description', 'limitations', 'legalNote']) if (!isNonEmptyStr(m[k])) err(`ruleCatalog[${i}].${k} missing`);
      if (m.ruleId !== RULE_ORDER[i]) err(`ruleCatalog[${i}].ruleId should be ${RULE_ORDER[i]}`);
    });

  if (r.explanation !== undefined) {
    const e = r.explanation;
    if (!isObj(e)) err('explanation must be an object');
    else {
      if (!['template', 'anthropic', 'openai'].includes(String(e.source))) err(`explanation.source invalid: ${String(e.source)}`);
      if (!Array.isArray(e.items)) err('explanation.items must be an array');
      else
        e.items.forEach((it, i) => {
          if (!isObj(it) || !isNonEmptyStr(it.ruleId) || !isNonEmptyStr(it.text)) err(`explanation.items[${i}] invalid`);
        });
      if (!(e.guardRejected === undefined || isNonEmptyStr(e.guardRejected))) err('explanation.guardRejected must be a non-empty string when present');
      if (!(e.model === undefined || isStr(e.model))) err('explanation.model must be a string when present');
    }
  }

  if (!isNonEmptyStr(r.disclaimer)) err('disclaimer missing');
  if (!Array.isArray(r.limitations) || r.limitations.length === 0 || !r.limitations.every(isNonEmptyStr)) err('limitations must be a non-empty string[]');
  return errs;
}
