# Spike C1 findings (2026-10-19): what Article 50 requires and what a scanner can check

**Status of evidence.** The official EUR-Lex pages could not be read in full by the tools used (the fetched text stopped inside the recitals), so the Article 50 wording below comes from an **unofficial copy** (artificialintelligenceact.eu), which itself shows two versions of paragraph 7. **Re-check the official text before any public claim.** Not legal advice.

## Dates and status (supersedes the earlier "provisional, not final law" note)
- Two secondary sources dated 28 Jul and 31 Jul 2026 (Future of Privacy Forum; Usercentrics) say the AI Omnibus was **adopted**: Parliament 16 June 2026, Council 29 June 2026, published in the Official Journal in July 2026 (Usercentrics says in force 27 July 2026 but hedges on publication; FPF does not state the in-force date). Confirm in the Official Journal.
- Article 50 applies generally from **2 August 2026**. Per both sources, the Omnibus delayed high-risk rules (Annex III to 2 Dec 2027, Annex I to 2 Aug 2028) and gives a grace period to **2 Dec 2026** for Article 50(2) content marking only for generative systems already on the market before 2 Aug 2026. FPF describes the postponement of 50(2) slightly differently (GPAI models); the two sources do not agree exactly. Verify.
- Penalty amounts for Article 50 breaches: **not confirmed** (Article 99 text not obtained).

## Who has which duty (unofficial text)
| Paragraph | Duty | On whom |
|---|---|---|
| 50(1) | Design AI systems that interact directly with people so people know it is an AI, unless obvious | **Providers** |
| 50(2) | Mark synthetic audio/image/video/text outputs in a machine-readable, detectable way | **Providers** (including general-purpose AI) |
| 50(3) | Inform people exposed to emotion recognition or biometric categorisation | **Deployers** |
| 50(4) | Disclose deepfakes (AI-generated or manipulated image/audio/video); disclose AI-generated text published to inform the public on matters of public interest unless human-reviewed under editorial responsibility | **Deployers** |
| 50(5) | Information must be clear, at the latest at first interaction/exposure, accessible | all of the above |

## What this means for the scanner idea (honest read)
1. **The chatbot-disclosure duty (50(1)) sits with the provider of the AI system** (the chatbot vendor or whoever builds it), not automatically with a small business that embeds a third-party widget. Some secondary sources phrase it as if every business "must disclose"; that is not what the unofficial text says. Whether a given SME counts as a provider or only a deployer depends on the facts. A "your chatbot has no disclosure" finding therefore may not be a legal failing of the site owner. **This weakens the pitch.**
2. **The deployer duties that clearly hit small businesses are 50(4)** (deepfakes, public-interest AI text), and a scanner **cannot tell** from outside whether an image is a deepfake or whether text was AI-generated and human-reviewed. These would mostly be "cannot tell".
3. **50(2) marking** falls on providers; a scanner can detect whether C2PA/IPTC markers exist on images, but absence does not prove anything and the duty is on the generator, not the site owner.
4. So the externally checkable, owner-relevant surface is **narrow**: presence of an AI chat widget and a nearby disclosure (good practice and possibly other laws), visible AI labels, and metadata markers.

## Revised view
Idea 03 is **weaker than recommended on 2026-10-19**. The people whose Article 50 duties a scanner can actually check are largely providers (chatbot and generative-AI vendors, plus agencies that build bots), not typical small site owners. Possible pivots to test before building: (a) sell to **agencies and chatbot builders** who are providers; (b) frame the product as a **disclosure best-practice and content-labelling audit**, not a legal-duty check; (c) drop it and use the 20-site test only if it is cheap. A lawyer's view (spike C4) matters before charging anyone.

## Sources
- Unofficial Article 50 text: https://artificialintelligenceact.eu/article/50/
- FPF, "The AI Act implementation timeline: what changes under the AI Omnibus" (28 Jul 2026, updated 5 Aug 2026): https://fpf.org/blog/the-ai-act-implementation-timeline-what-changes-under-the-ai-omnibus/
- Usercentrics, "EU AI Act Deal: Digital Omnibus now in force" (31 Jul 2026): https://usercentrics.com/knowledge-hub/eu-ai-act-high-risk-delay-article-50-transparency-consent/
- Official text to verify against: https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng
