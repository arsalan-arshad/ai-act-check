// Plausible-looking third-party widget script URLs used ONLY as <script src> strings.
// The e2e environment is offline: the scanner must detect these from the tag alone and the
// fixtures never depend on the script loading. The URL shapes are illustrative and unverified.
export interface VendorFixture {
  name: string;
  src: string;
  /** Substring expected in the evidence value for this vendor. */
  evidenceHint: string;
}

export const VENDOR_FIXTURES: VendorFixture[] = [
  { name: 'intercom', src: 'https://widget.intercom.io/widget/abcd1234', evidenceHint: 'intercom' },
  { name: 'drift', src: 'https://js.driftt.com/include/1700000000000/abcd1234.js', evidenceHint: 'driftt' },
  { name: 'tidio', src: 'https://code.tidio.co/abcdefghijklmnop.js', evidenceHint: 'tidio' },
  { name: 'crisp', src: 'https://client.crisp.chat/l.js', evidenceHint: 'crisp' },
  { name: 'tawk', src: 'https://embed.tawk.to/0123456789abcdef/default', evidenceHint: 'tawk' },
  { name: 'livechat', src: 'https://cdn.livechatinc.com/tracking.js', evidenceHint: 'livechat' },
];

export function vendorPage(src: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Vendor widget</title></head><body><h1>Shop</h1><p>Welcome.</p><script async src="${src}"></script></body></html>`;
}
