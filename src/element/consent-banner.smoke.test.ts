import { describe, it, expect, beforeAll } from 'vitest';

// Guards the distribution contract: importing the package must register the
// custom element (so a bare `import '@temporalio-web/consent-banner'` / <script> tag
// is enough), and the element must upgrade into a shadow root.
describe('temporal-consent-banner registration', () => {
  beforeAll(async () => {
    await import('../index');
  });

  it('registers the custom element on import', () => {
    expect(customElements.get('temporal-consent-banner')).toBeDefined();
  });

  it('upgrades and attaches a shadow root', async () => {
    const el = document.createElement('temporal-consent-banner');
    document.body.append(el);
    await el.updateComplete;

    expect(el.shadowRoot).not.toBeNull();

    el.remove();
  });
});
