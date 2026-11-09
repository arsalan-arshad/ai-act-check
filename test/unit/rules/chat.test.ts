import { describe, expect, it } from 'vitest';
import { runRules } from '../../../src/rules/index.js';
import type { Finding } from '../../../src/types.js';
import { candidate, iframe, makeCrawl, makePage, script } from './helpers.js';

function rule(findings: Finding[], id: string): Finding {
  const found = findings.find((f) => f.ruleId === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

const chat01 = (pages: Parameters<typeof makeCrawl>[0]) => rule(runRules(makeCrawl(pages)), 'CHAT-01');
const chat02 = (pages: Parameters<typeof makeCrawl>[0]) => rule(runRules(makeCrawl(pages)), 'CHAT-02');

describe('CHAT-01', () => {
  it('found: vendor script src', () => {
    const f = chat01([makePage({ scripts: [script('https://widget.intercom.io/widget/abc123')] })]);
    expect(f.outcome).toBe('found');
    expect(f.needsHumanJudgement).toBe(true);
    expect(f.summary).toMatch(/chat widget detected/i);
    expect(f.summary).toContain('Intercom');
    expect(f.summary).not.toMatch(/ai chatbot/i);
    expect(f.evidence[0]).toMatchObject({ kind: 'script', url: 'https://example.test/' });
    expect(f.evidence[0]?.value).toContain('widget.intercom.io');
  });

  it('found: inline snippet marker', () => {
    const f = chat01([makePage({ scripts: [script(null, "window.Tawk_API = window.Tawk_API || {};")] })]);
    expect(f.outcome).toBe('found');
    expect(f.summary).toContain('Tawk.to');
    expect(f.evidence[0]?.value).toContain('inline script');
  });

  it('found: vendor iframe src', () => {
    const f = chat01([makePage({ iframes: [iframe({ src: 'https://bot.landbot.io/v3/H-1/index.html' })] })]);
    expect(f.outcome).toBe('found');
    expect(f.summary).toContain('Landbot');
  });

  it('found: vendor DOM id from a candidate, including shadow DOM', () => {
    const f = chat01([makePage({ domCandidates: [candidate({ id: 'tidio-chat', inShadowRoot: true, visible: false })] })]);
    expect(f.outcome).toBe('found');
    expect(f.summary).toContain('Tidio');
  });

  it('found: vendor class in the page markup and custom element tag', () => {
    const byClass = chat01([makePage({ html: '<div class="foo intercom-lightweight-app"></div>' })]);
    expect(byClass.outcome).toBe('found');
    expect(byClass.summary).toContain('Intercom');
    const byTag = chat01([makePage({ html: '<body><df-messenger intent="x"></df-messenger></body>' })]);
    expect(byTag.outcome).toBe('found');
    expect(byTag.summary).toContain('Dialogflow Messenger');
  });

  it('found: generic visible candidate with a strong chat class', () => {
    const f = chat01([makePage({ domCandidates: [candidate({ className: 'site-chat-widget open', matchedBy: 'class' })] })]);
    expect(f.outcome).toBe('found');
    expect(f.summary).toContain('unidentified chat-like element');
    expect(f.evidence[0]?.value).toContain('no known vendor');
  });

  it('found: generic visible candidate with a strong aria-label', () => {
    const f = chat01([makePage({ domCandidates: [candidate({ ariaLabel: 'Open chat', matchedBy: 'aria' })] })]);
    expect(f.outcome).toBe('found');
  });

  it('found: generic visible iframe titled as a chat widget', () => {
    const f = chat01([makePage({ iframes: [iframe({ title: 'Live chat', src: 'https://x.example.test/a' })] })]);
    expect(f.outcome).toBe('found');
  });

  it('not_found: no known widget, and the summary states the limits', () => {
    const f = chat01([makePage(), makePage({ url: 'https://example.test/about' })]);
    expect(f.outcome).toBe('not_found');
    expect(f.summary).toMatch(/no known chat widget detected in the rendered pages/i);
    expect(f.evidence.map((e) => [e.url, e.kind])).toEqual([
      ['https://example.test/', 'text'],
      ['https://example.test/about', 'text'],
    ]);
    expect(f.evidence[0]?.value).toMatch(/^Checked https:\/\/example\.test\/: no known chat widget matched \(\d+ vendor fingerprints, generic heuristics\)$/);
    expect(f.evidence[0]?.capturedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(f.reason).toBeUndefined();
    expect(f.pagesEvaluated).toEqual(['https://example.test/', 'https://example.test/about']);
  });

  it('does not treat a blog comment "chat" class alone as a widget', () => {
    const f = chat01([
      makePage({
        domCandidates: [
          candidate({ className: 'chat', text: 'Join the chat below' }),
          candidate({ className: 'comment-chat-list', id: 'chat-comments' }),
          candidate({ className: 'chatter' }),
        ],
      }),
    ]);
    expect(f.outcome).toBe('not_found');
  });

  it('not_found carries a text item and a screenshot item per evaluated page, capped at 20', () => {
    const one = chat01([makePage({ screenshot: 'screenshots/page-1.png', finalUrl: 'https://example.test/final' })]);
    expect(one.evidence.map((e) => e.kind)).toEqual(['text', 'screenshot']);
    expect(one.evidence[0]?.value).toContain('Checked https://example.test/final');
    expect(one.evidence[1]).toMatchObject({ value: 'screenshots/page-1.png', capturedAt: '2026-01-01T00:00:00.000Z' });
    const many = chat01(Array.from({ length: 15 }, (_, i) => makePage({ url: `https://example.test/p${i}`, screenshot: `screenshots/page-${i}.png` })));
    expect(many.evidence).toHaveLength(20);
    expect(many.summary).toMatch(/first pages only/);
  });

  it('does not treat a hidden candidate with a strong class as a widget', () => {
    const f = chat01([makePage({ domCandidates: [candidate({ className: 'chat-widget', visible: false })] })]);
    expect(f.outcome).toBe('not_found');
  });

  it('found: visible chat-named iframe with a weak id (id "chat-frame", title "Chat")', () => {
    const f = chat01([makePage({ iframes: [iframe({ id: 'chat-frame', title: 'Chat', src: 'https://example.test/frame.html', accessible: true, text: 'You are chatting with an AI assistant.' })] })]);
    expect(f.outcome).toBe('found');
    expect(f.evidence[0]?.value).toContain('heuristic: chat token in id "chat-frame" of a visible iframe');
    expect(chat02([makePage({ iframes: [iframe({ id: 'chat-frame', title: 'Chat', accessible: true, text: 'You are chatting with an AI assistant.' })] })]).outcome).toBe('found');
  });

  it.each([
    [{ className: 'support' , title: 'Assistant' }],
    [{ title: 'Messenger' }],
    [{ className: 'x livechat' }],
    [{ id: 'helpdesk-widget' }],
  ])('found: visible iframe with chat token %j', (overrides) => {
    expect(chat01([makePage({ iframes: [iframe(overrides)] })]).outcome).toBe('found');
  });

  it('not_found: hidden chat-named iframe, or iframes with chat only inside another word', () => {
    expect(chat01([makePage({ iframes: [iframe({ id: 'chat-frame', visible: false })] })]).outcome).toBe('not_found');
    expect(chat01([makePage({ iframes: [iframe({ id: 'chatter-frame', title: 'Purchase' }), iframe({ className: 'chatham' })] })]).outcome).toBe('not_found');
  });

  it('found: visible open-shadow element with a chat class under a weak host id', () => {
    const f = chat01([
      makePage({
        domCandidates: [
          candidate({ id: 'assistant-host', text: 'You are chatting with an AI assistant.', matchedBy: 'id' }),
          candidate({ className: 'chat-panel panel', inShadowRoot: true, text: 'You are chatting with an AI assistant.' }),
        ],
      }),
    ]);
    expect(f.outcome).toBe('found');
    expect(f.evidence[0]?.value).toContain('heuristic: chat-widget compound token "chat-panel"');
  });

  it('found: visible shadow-DOM element with a bare "chat" class, but not the same class in the light DOM', () => {
    const shadow = chat01([makePage({ domCandidates: [candidate({ className: 'chat', inShadowRoot: true })] })]);
    expect(shadow.outcome).toBe('found');
    expect(shadow.evidence[0]?.value).toContain('visible shadow-DOM element');
    expect(chat01([makePage({ domCandidates: [candidate({ className: 'chat', inShadowRoot: false })] })]).outcome).toBe('not_found');
    expect(chat01([makePage({ domCandidates: [candidate({ className: 'chat', inShadowRoot: true, visible: false })] })]).outcome).toBe('not_found');
  });

  it.each(['chat-widget', 'chat-panel', 'chat-launcher', 'chat-window', 'chat-bubble', 'chat-frame', 'chatbot', 'chat_bot', 'assistant-widget', 'assistant-panel', 'widget-chat', 'bot-chat', 'live-chat', 'webchat'])(
    'found: visible light-DOM element with compound token %s',
    (className) => {
      expect(chat01([makePage({ domCandidates: [candidate({ className })] })]).outcome).toBe('found');
    },
  );

  it.each(['chat', 'chat-comments', 'chat-message', 'chatter', 'assistant', 'chat-history', 'panel', 'widget', 'frame-rate'])(
    'not_found: light-DOM class %s alone is not a widget',
    (className) => {
      expect(chat01([makePage({ domCandidates: [candidate({ className })] })]).outcome).toBe('not_found');
    },
  );

  it('not_found: a blog with a chat comment section and "chatbot" in prose', () => {
    const f = chat01([
      makePage({
        text: 'Weizenbaum wrote an early chatbot. Join the chat below.',
        domCandidates: [candidate({ className: 'comments chat', text: 'Anna: great post!' }), candidate({ className: 'chat', text: 'Ben: thanks' })],
      }),
    ]);
    expect(f.outcome).toBe('not_found');
  });

  it('does not match "bot" inside other words', () => {
    const f = chat01([
      makePage({
        text: 'Robotics, abbot and bottle',
        html: '<div class="robot-arm abbot bottle-cap"></div>',
        domCandidates: [candidate({ className: 'robot-arm', ariaLabel: 'Robotics lab' })],
      }),
    ]);
    expect(f.outcome).toBe('not_found');
  });

  it('does not match vendor names that only appear in page text', () => {
    const f = chat01([makePage({ text: 'We compare Intercom, Drift and Crisp.', html: '<p>Intercom vs Drift</p>' })]);
    expect(f.outcome).toBe('not_found');
  });

  it('does not treat HubSpot tracking or form embeds as a chat widget', () => {
    const f = chat01([makePage({ scripts: [script('https://js.hs-scripts.com/123.js')], iframes: [iframe({ src: 'https://forms.hubspot.com/embed' })] })]);
    expect(f.outcome).toBe('not_found');
  });

  it('lists evidence per page and takes the screenshot from the first contributing page', () => {
    const f = chat01([
      makePage({ screenshot: 'screenshots/page-1.png' }),
      makePage({ url: 'https://example.test/b', screenshot: 'screenshots/page-2.png', scripts: [script('https://client.crisp.chat/l.js')] }),
    ]);
    expect(f.outcome).toBe('found');
    const shot = f.evidence.find((e) => e.kind === 'screenshot');
    expect(shot).toMatchObject({ url: 'https://example.test/b', value: 'screenshots/page-2.png' });
    expect(f.evidence[0]?.url).toBe('https://example.test/b');
    expect(f.evidence[0]?.capturedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('caps evidence at 20 items and notes the cap', () => {
    const pages = Array.from({ length: 30 }, (_, i) =>
      makePage({ url: `https://example.test/p${i}`, screenshot: `screenshots/page-${i}.png`, scripts: [script('https://client.crisp.chat/l.js')] }),
    );
    const f = chat01(pages);
    expect(f.evidence).toHaveLength(20);
    expect(f.evidence.at(-1)?.kind).toBe('screenshot');
    expect(f.summary).toMatch(/capped at 20/);
    expect(f.summary).toMatch(/11 more matches/);
  });

  it('survives hostile input: huge script src and html', () => {
    const f = chat01([
      makePage({
        scripts: [script(`https://x.test/${'a'.repeat(100_000)}`)],
        html: `<div class="${'a '.repeat(50_000)}"></div>${'<i id="x"'.repeat(10_000)}`,
      }),
    ]);
    expect(f.outcome).toBe('not_found');
  });
});

describe('CHAT-02', () => {
  const widget = (extra: Parameters<typeof candidate>[0] = {}) =>
    candidate({ id: 'tidio-chat', text: '', ...extra });

  it('cannot_tell/no_widget_detected when CHAT-01 is not found', () => {
    const f = chat02([makePage()]);
    expect(f.outcome).toBe('cannot_tell');
    expect(f.reason).toBe('no_widget_detected');
    expect(f.summary).toBe('Nothing to check: no chat widget was detected.');
    expect(f.needsHumanJudgement).toBe(false);
  });

  it('found: disclosure wording in a widget element, flagged for human judgement', () => {
    const f = chat02([makePage({ domCandidates: [widget({ text: 'Hi! You are chatting with an AI assistant. Ask me anything.' })] })]);
    expect(f.outcome).toBe('found');
    expect(f.needsHumanJudgement).toBe(true);
    expect(f.evidence[0]).toMatchObject({ kind: 'text' });
    expect(f.evidence[0]?.value).toMatch(/AI assistant/i);
    expect(f.pagesEvaluated).toEqual(['https://example.test/']);
  });

  it('found: wording in an accessible vendor iframe', () => {
    const f = chat02([
      makePage({ iframes: [iframe({ src: 'https://bot.landbot.io/x', accessible: true, text: 'This is an automated assistant.' })] }),
    ]);
    expect(f.outcome).toBe('found');
    expect(f.evidence[0]?.value).toContain('iframe');
  });

  it('found: wording only in the aria-label of the widget element', () => {
    const f = chat02([makePage({ domCandidates: [widget({ ariaLabel: 'Virtual assistant', text: '' })] })]);
    expect(f.outcome).toBe('found');
    expect(f.evidence[0]?.value).toContain('aria-label');
  });

  it('found: wording in the iframe title', () => {
    const f = chat02([makePage({ iframes: [iframe({ src: 'https://bot.landbot.io/x', title: 'AI assistant' })] })]);
    expect(f.outcome).toBe('found');
  });

  it.each([
    ['de', 'Willkommen! Sie chatten mit einer KI.'],
    ['de', 'Ihr KI-Assistent hilft Ihnen gerne.'],
    ['fr', 'Bonjour, vous discutez avec une IA.'],
    ['fr', 'Je suis votre assistant virtuel.'],
    ['es', 'Hola, estás hablando con una IA.'],
    ['es', 'Soy tu asistente virtual'],
    ['it', 'Ciao, stai parlando con un bot.'],
    ['it', "Stai chattando con un’IA"],
    ['nl', 'Je praat met een AI-assistent.'],
    ['nl', 'Welkom bij onze virtuele assistent'],
    ['pt', 'Você está falando com uma IA.'],
    ['pt', 'Olá, sou o assistente virtual'],
    ['pl', 'Rozmawiasz z botem.'],
    ['pl', 'Jestem asystentem AI sklepu.'],
    ['en', "Heads up: you're chatting with an AI"],
    ['en', 'Powered by AI'],
    ['en', 'Chatbot'],
  ])('found: %s wording "%s"', (_lang, text) => {
    const f = chat02([makePage({ domCandidates: [widget({ text })] })]);
    expect(f.outcome).toBe('found');
  });

  it('is accent-insensitive in both directions', () => {
    expect(chat02([makePage({ domCandidates: [widget({ text: 'ESTAS HABLANDO CON UNA IA' })] })]).outcome).toBe('found');
    expect(chat02([makePage({ domCandidates: [widget({ text: 'Vous echangez avec une IA' })] })]).outcome).toBe('found');
    expect(chat02([makePage({ domCandidates: [widget({ text: 'Sie chatten mit einer KI' })] })]).outcome).toBe('found');
  });

  it('does not match "bot" inside other words', () => {
    const f = chat02([makePage({ domCandidates: [widget({ text: 'Robotics abbot bottle. Ask a question.' })] })]);
    expect(f.outcome).toBe('not_found');
  });

  it('not_found: inspectable widget text without disclosure wording, still needs human judgement', () => {
    const f = chat02([makePage({ domCandidates: [widget({ text: 'Hi there! How can we help you today?' })] })]);
    expect(f.outcome).toBe('not_found');
    expect(f.needsHumanJudgement).toBe(true);
    expect(f.reason).toBeUndefined();
    expect(f.summary).toMatch(/opened/);
    expect(f.evidence).toHaveLength(1);
    expect(f.evidence[0]).toMatchObject({ kind: 'text', url: 'https://example.test/', capturedAt: '2026-01-01T00:00:00.000Z' });
    expect(f.evidence[0]?.value).toMatch(/^Checked https:\/\/example\.test\/: no AI-assistant or bot wording matched/);
  });

  it('not_found: accessible iframe text counts as inspectable', () => {
    const f = chat02([
      makePage({ iframes: [iframe({ src: 'https://bot.landbot.io/x', accessible: true, text: 'Hello, how can I help?' })] }),
    ]);
    expect(f.outcome).toBe('not_found');
  });

  it('cannot_tell/widget_ui_not_inspectable: script-only detection', () => {
    const f = chat02([makePage({ scripts: [script('https://widget.intercom.io/widget/abc')] })]);
    expect(f.outcome).toBe('cannot_tell');
    expect(f.reason).toBe('widget_ui_not_inspectable');
    expect(f.summary).toMatch(/not a pass/i);
  });

  it('cannot_tell/widget_ui_not_inspectable: cross-origin iframe and empty launcher', () => {
    const f = chat02([
      makePage({
        iframes: [iframe({ src: 'https://bot.landbot.io/x', accessible: false, text: null })],
        domCandidates: [widget({ text: '   ' })],
      }),
    ]);
    expect(f.outcome).toBe('cannot_tell');
    expect(f.reason).toBe('widget_ui_not_inspectable');
  });

  it('does not use unrelated page text or non-widget candidates', () => {
    const f = chat02([
      makePage({
        text: 'You are chatting with an AI assistant',
        scripts: [script('https://widget.intercom.io/widget/abc')],
        domCandidates: [candidate({ className: 'comments', text: 'You are chatting with an AI assistant' })],
      }),
    ]);
    expect(f.outcome).toBe('cannot_tell');
  });

  it('only evaluates pages that contain a widget', () => {
    const f = chat02([
      makePage({ url: 'https://example.test/a' }),
      makePage({ url: 'https://example.test/b', domCandidates: [widget({ text: 'virtual assistant' })] }),
    ]);
    expect(f.pagesEvaluated).toEqual(['https://example.test/b']);
  });
});
