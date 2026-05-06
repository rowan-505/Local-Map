/** Dev-only probes for `/fonts/` glyph PBFs (see `public/fonts/README.md`). */
export function logGlyphServingHealthInDev(): void {
  if (!import.meta.env.DEV) return;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const baseUrl = import.meta.env.BASE_URL;
  const paths = ['fonts/NotoSansMyanmar-Regular/0-255.pbf', 'fonts/NotoSansMyanmar-Regular/4096-4351.pbf'] as const;

  void Promise.all(
    paths.map(async (p) => {
      const url = `${origin}${baseUrl.replace(/\/$/, '')}/${p}`;
      try {
        const res = await fetch(url);
        const buf = new Uint8Array(await res.arrayBuffer());
        const headHex = Array.from(buf.slice(0, 8))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(' ');
        const sniff = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 64)) : '';
        const looksLikeHtml =
          sniff.trimStart().startsWith('<!DOCTYPE') ||
          sniff.trimStart().startsWith('<html');
        const looksLikeGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
        console.info('[glyph dev]', `${p}`, { status: res.status, bytes: buf.length, contentType: res.headers.get('content-type'), headHex });
        if (!res.ok) console.warn('[glyph dev] HTTP failure — labels may disappear for this range.', p);
        if (looksLikeHtml) console.error('[glyph dev] Response looks like HTML (wrong route/asset). MapLibre may log glyph parse errors.', p);
        if (looksLikeGzip && (res.headers.get('content-encoding') || '').includes('gzip')) {
          console.info('[glyph dev] gzip-encoded response; decode should yield raw PBF in browser.', p);
        }
      } catch (e) {
        console.warn('[glyph dev] fetch failed', p, e);
      }
    }),
  );
}
