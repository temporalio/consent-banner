import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The built IIFE is the Marketo `<script>` distribution path: no bundler and no
// import map, so loading the file alone must self-register the element (Lit is
// bundled in). This is skipped in a plain `vitest run` because `dist` may not
// exist; `pnpm test:bundle` builds first and then activates it.
//
// Resolve from the package root (vitest's cwd) rather than `import.meta.url`:
// under the jsdom environment `import.meta.url` is an http URL, not file://.
const bundlePath = resolve(process.cwd(), 'dist/cookie-banner.iife.js');
const bundleExists = existsSync(bundlePath);

describe.skipIf(!bundleExists)('IIFE bundle (script-tag distribution)', () => {
  it('self-registers and upgrades the element when evaluated', async () => {
    const code = readFileSync(bundlePath, 'utf8');
    // Execute the IIFE in the jsdom global scope, mirroring a <script> tag; we
    // only care about its side effect (customElements.define).
    new Function(code)();

    expect(customElements.get('temporal-cookie-banner')).toBeDefined();

    const el = document.createElement('temporal-cookie-banner');
    document.body.append(el);
    await (el as unknown as { updateComplete: Promise<unknown> })
      .updateComplete;

    expect(el.shadowRoot).not.toBeNull();
    el.remove();
  });
});
