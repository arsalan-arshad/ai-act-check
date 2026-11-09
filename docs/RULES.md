# Draft rule list (unconfirmed)

Every rule below is a **hypothesis until spike C1** confirms the legal basis from primary sources. Each rule must have: id, plain-language title, what it looks for, evidence it records, a fixture test with a passing and a failing page, and a "needs human judgement" flag.

| id | Looks for | Evidence | Notes |
|---|---|---|---|
| CHAT-01 | Known chat widgets and chat-like iframes/scripts | script URL, DOM snippet, screenshot | List of vendors maintained in `rules/vendors.json` |
| CHAT-02 | AI disclosure text near a detected widget (for example "AI assistant", "virtual assistant", "you are chatting with a bot") | matched text, location, screenshot | Wording list per language; cannot judge whether wording is adequate, flag for a human |
| MEDIA-01 | Images/video with AI-generation metadata (C2PA, IPTC DigitalSourceType) | metadata fields | Absence of metadata does not prove the media is human-made |
| MEDIA-02 | Visible "AI-generated" label near media flagged by MEDIA-01 | text, screenshot | |
| PAGE-01 | A page or link about AI use/transparency | URL, link text | Presence only; content quality not judged |

Findings have three states: **found**, **not found**, **cannot tell**. "Cannot tell" is a valid, common result and must never be shown as a pass.
