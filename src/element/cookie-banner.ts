import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import {
  clearConsentCookie,
  defaultConsent,
  readConsentFromDocumentCookie,
  writeConsentCookie,
  type ConsentRecord,
} from '../core/consent';
import {
  isConsentRegime,
  shouldRepromptOnRegimeChange,
  type ConsentRegime,
} from '../core/consent-region';
import {
  dispatchConsentChange,
  persistConsent,
  persistDoNotSell,
  persistRegime,
  pushConsentSignals,
} from './consent-sync';

/** Global event a host can dispatch on `window` to (re)open the notice, e.g. a
 *  footer "Cookie preferences" link. Framework-neutral alternative to holding a
 *  reference and calling `.open()`. */
export const OPEN_EVENT = 'temporal:cookie-banner-open';

/** Best-effort JSON read from localStorage (mirrors persistStore's format).
 *  Never throws — private mode / quota / corrupt value all yield null. */
const readJSON = <T>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

const sessionGet = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const sessionSet = (key: string, value: string): void => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Session storage unavailable — non-fatal (only affects the once-per-session
    // geo reconciliation guard).
  }
};

/**
 * `<temporal-cookie-banner>`
 *
 * Framework-neutral consent notice for temporal.io properties (originally the
 * SvelteKit app's cookie modal, since removed in favor of this element).
 * Resolves the visitor's consent regime from edge
 * geolocation (`/api/geo`), renders the region-appropriate notice
 * (opt_in customize panel / us_opt_out "Do Not Sell" toggle / plain
 * accept-decline), reconciles a stored decision once per session so a move into
 * a stronger-obligation regime re-prompts, and fans a committed decision out to
 * localStorage, BroadcastChannel, the `.temporal.io` cookie, Google Consent
 * Mode, and a host `temporal:consentchange` event (see `consent-sync.ts`).
 *
 * Styling is scoped to this shadow root; theme per-property via the `--tcb-*`
 * custom properties declared on `:host`.
 */
export class TemporalCookieBanner extends LitElement {
  static properties = {
    _mounted: { state: true },
    _showPreferences: { state: true },
    _regime: { state: true },
    _geoResolved: { state: true },
    _visible: { state: true },
    _analytics: { state: true },
    _advertising: { state: true },
    _doNotSell: { state: true },
    _consent: { state: true },
    policyUrl: { type: String, attribute: 'policy-url' },
    geoEndpoint: { type: String, attribute: 'geo-endpoint' },
  };

  // Gate first render behind mount + geo so opt-out visitors never flash the
  // notice and there's no SSR/hydration flash before storage can be read.
  _mounted = false;
  _showPreferences = false;
  _geoResolved = false;
  // Footer-reopen visibility, independent of the first-load notice.
  _visible = false;

  // Local (uncommitted) preference-center toggle state.
  _analytics = false;
  _advertising = false;
  _doNotSell = false;

  _regime: ConsentRegime = 'opt_in';
  _consent: ConsentRecord = defaultConsent();

  // Cookie-policy link target. Defaults to the apex ABSOLUTE URL so the link
  // resolves everywhere the component is embedded (docs / learn / pages, which
  // are not under temporal.io's routing); override per host via the `policy-url`
  // attribute.
  policyUrl = 'https://temporal.io/temporal-cookie-policy';

  // Geolocation endpoint that resolves the visitor's consent regime. Defaults to
  // the same-origin `/api/geo` (the host site's own route). Hosts without that
  // route (docs / learn / pages) point this at the canonical absolute endpoint,
  // e.g. `geo-endpoint="https://consent.temporal.io/api/geo"`. Accepts absolute
  // or root-relative URLs; forwarded testing params are merged in `fetchGeo`.
  geoEndpoint = '/api/geo';

  // Non-reactive: the last COMMITTED do-not-sell value (distinct from the live
  // toggle above, so an explicit decision can detect a change against it).
  private _committedDoNotSell = false;
  // Non-reactive guards for the lazy footer-reopen regime lookup.
  private _regimeKnown = false;
  private _regimeRequested = false;
  // One-time guard so the mount orchestration runs once even if the element is
  // moved within the DOM (which re-fires connectedCallback).
  private _initialized = false;

  private readonly GEO_FETCH_TIMEOUT_MS = 3000;
  private readonly GEO_RECONCILED_KEY = 'consent-geo-reconciled';

  private readonly _onOpenEvent = () => this.open();

  constructor() {
    super();
    const storedConsent = readJSON<ConsentRecord>('consent');
    this._consent = storedConsent ?? defaultConsent();

    const storedDoNotSell = readJSON<boolean>('do-not-sell') ?? false;
    this._doNotSell = storedDoNotSell;
    this._committedDoNotSell = storedDoNotSell;

    const storedRegime = readJSON<unknown>('consent-regime');
    this._regimeKnown = isConsentRegime(storedRegime);
    this._regime = this._regimeKnown
      ? (storedRegime as ConsentRegime)
      : 'opt_in';

    this._analytics = this._consent?.analytics ?? false;
    this._advertising = this._consent?.advertising ?? false;
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener(OPEN_EVENT, this._onOpenEvent);

    // Run the mount/orchestration once, BEFORE the first render, so the initial
    // state (`_mounted`, any adopted cookie decision) is part of the first
    // update rather than a second one. Doing this in `firstUpdated` would set a
    // reactive property after the update completed and force an extra render.
    // Guarded so a move within the DOM (re-connect) doesn't re-run it.
    if (!this._initialized) {
      this._initialized = true;
      this.initialize();
    }
  }

  disconnectedCallback(): void {
    window.removeEventListener(OPEN_EVENT, this._onOpenEvent);
    super.disconnectedCallback();
  }

  // --- Lifecycle: the former Svelte onMount ---------------------------------

  private initialize(): void {
    // Adopt a decision held only in the SSR cookie when local storage is empty
    // (e.g. a cross-subdomain visitor whose decision arrived via the cookie).
    const fromCookie = readConsentFromDocumentCookie();
    if (!this._consent?.decided && fromCookie.decided) {
      this._consent = fromCookie;
      persistConsent(fromCookie);
    }

    // Keep the SSR-readable cookie aligned with the persisted decision.
    if (this._consent?.decided) {
      writeConsentCookie(this._consent);
    }

    this._mounted = true;

    if (this._consent?.decided) {
      // A stored decision governs behavior, so skip geo — but reconcile ONCE per
      // session so a visitor who moved into a stronger-obligation regime is
      // re-prompted. The session guard keeps the fast path on later loads.
      if (sessionGet(this.GEO_RECONCILED_KEY)) {
        return;
      }
      void (async () => {
        const { regime: currentRegime, gpc } = await this.fetchGeo();
        sessionSet(this.GEO_RECONCILED_KEY, '1');

        const stored = readJSON<unknown>('consent-regime');
        const previousRegime = isConsentRegime(stored) ? stored : null;

        if (shouldRepromptOnRegimeChange(previousRegime, currentRegime)) {
          this.repromptForRegime(currentRegime, gpc);
          return;
        }

        // Same or weaker regime: keep the decision, reflect the current region
        // in the footer variant, but never lower the persisted regime.
        this._regime = currentRegime;
        this._regimeKnown = true;
        this._geoResolved = true;
        if (previousRegime == null) {
          persistRegime(currentRegime);
        }
      })();
      return;
    }

    // No decision yet: resolve the regime and apply the region's first-load
    // default, persisting the regime for a later footer reopen.
    void (async () => {
      const { regime: resolvedRegime, gpc } = await this.fetchGeo();
      this.applyRegimeFirstLoad(resolvedRegime, gpc);
    })();
  }

  // --- Public API -----------------------------------------------------------

  /** Open the notice straight into the preference center (footer reopen). Lazily
   *  resolves the regime if this visitor never resolved geo (e.g. a decision
   *  made before regime persistence, or cleared storage). */
  open(): void {
    this.syncLocalToggles();
    this._showPreferences = true;
    this._visible = true;

    if (!this._regimeKnown && !this._regimeRequested) {
      this._regimeRequested = true;
      void this.fetchGeo().then(({ regime }) => {
        this._regime = regime;
        persistRegime(regime);
        this._regimeKnown = true;
      });
    }
  }

  // --- Preference-center state ----------------------------------------------

  private syncLocalToggles(): void {
    this._analytics = this._consent?.analytics ?? false;
    this._advertising = this._consent?.advertising ?? false;
    this._doNotSell = this._committedDoNotSell;
  }

  private togglePreferences(): void {
    if (this._showPreferences) {
      this._showPreferences = false;
    } else {
      this.syncLocalToggles();
      this._showPreferences = true;
    }
  }

  // --- Commit paths ---------------------------------------------------------

  private applyConsent(categories: {
    analytics: boolean;
    advertising: boolean;
  }): void {
    const next: ConsentRecord = {
      decided: true,
      necessary: true,
      analytics: categories.analytics,
      advertising: categories.advertising,
    };

    // The Do-Not-Sell toggle is only an independent control in us_opt_out.
    // Elsewhere the sale/share signal is governed by the advertising choice.
    const isOptOut = this._regime === 'us_opt_out';
    const effectiveDoNotSell = isOptOut
      ? this._doNotSell
      : !categories.advertising;

    const previous = this._consent;
    const didChange =
      !previous ||
      !previous.decided ||
      previous.analytics !== next.analytics ||
      previous.advertising !== next.advertising ||
      this._committedDoNotSell !== effectiveDoNotSell;

    this._consent = next;
    persistConsent(next);
    this._committedDoNotSell = effectiveDoNotSell;
    this._doNotSell = effectiveDoNotSell;
    persistDoNotSell(effectiveDoNotSell);

    this._visible = false;
    this._showPreferences = false;

    writeConsentCookie(next);
    pushConsentSignals({
      analytics: next.analytics,
      advertising: next.advertising,
      doNotSell: effectiveDoNotSell,
    });

    // Re-run consent-dependent host work (e.g. experiment assignment) without a
    // full reload that would overwrite document.referrer with a self-referral.
    if (didChange) {
      dispatchConsentChange({
        consent: next,
        doNotSell: effectiveDoNotSell,
        regime: this._regime,
      });
    }
  }

  /** First-load default for opt-out regions: grant optional categories, honoring
   *  GPC. us_opt_out stays undecided (its notice shows once); us_basic/row are
   *  granted silently. */
  private applyDefaultGrant(markDecided: boolean, gpc: boolean): void {
    this._doNotSell = gpc;
    this._committedDoNotSell = gpc;
    this._analytics = true;
    this._advertising = true;

    const next: ConsentRecord = {
      decided: markDecided,
      necessary: true,
      analytics: true,
      advertising: true,
    };
    this._consent = next;
    persistConsent(next);
    persistDoNotSell(gpc);

    pushConsentSignals({ analytics: true, advertising: true, doNotSell: gpc });

    // Only the decided path (us_basic/row) writes the SSR cookie and re-runs
    // host loads; us_opt_out stays undecided with no cookie.
    if (markDecided) {
      writeConsentCookie(next);
      dispatchConsentChange({
        consent: next,
        doNotSell: gpc,
        regime: this._regime,
      });
    }
  }

  private acceptAll = (): void =>
    this.applyConsent({ analytics: true, advertising: true });

  private rejectAll = (): void =>
    this.applyConsent({ analytics: false, advertising: false });

  private savePreferences = (): void =>
    this.applyConsent({
      analytics: this._analytics,
      advertising: this._advertising,
    });

  // --- Geo + regime ---------------------------------------------------------

  private async fetchGeo(): Promise<{ regime: ConsentRegime; gpc: boolean }> {
    // Resolve the configured endpoint against the current origin so a
    // root-relative default (`/api/geo`) and an absolute override
    // (`https://consent.temporal.io/api/geo`) are both handled, preserving any
    // query string already present on the endpoint.
    const geoUrl = new URL(this.geoEndpoint, window.location.origin);
    const search = new URLSearchParams(window.location.search);
    for (const key of ['country', 'region', 'gpc']) {
      const value = search.get(key);
      if (value) {
        geoUrl.searchParams.set(key, value);
      }
    }

    // Best-effort timeout: a stalled fetch would otherwise suppress the notice
    // indefinitely. Aborting falls through to the strict opt_in default so the
    // banner still renders (fail safe to the most protective regime).
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.GEO_FETCH_TIMEOUT_MS,
    );

    try {
      const response = await fetch(geoUrl.toString(), {
        signal: controller.signal,
      });
      if (response.ok) {
        const data: unknown = await response.json();
        const record = (data ?? {}) as { regime?: unknown; gpc?: unknown };
        return {
          regime: isConsentRegime(record.regime) ? record.regime : 'opt_in',
          gpc: typeof record.gpc === 'boolean' ? record.gpc : false,
        };
      }
    } catch {
      // Network/endpoint failure or timeout abort: fall through to strict opt_in.
    } finally {
      clearTimeout(timeoutId);
    }
    return { regime: 'opt_in', gpc: false };
  }

  private applyRegimeFirstLoad(
    resolvedRegime: ConsentRegime,
    gpc: boolean,
  ): void {
    this._regime = resolvedRegime;
    persistRegime(resolvedRegime);
    this._regimeKnown = true;
    this._geoResolved = true;

    if (resolvedRegime === 'opt_in') {
      return;
    }
    this.applyDefaultGrant(resolvedRegime !== 'us_opt_out', gpc);
  }

  private repromptForRegime(currentRegime: ConsentRegime, gpc: boolean): void {
    this._regime = currentRegime;
    persistRegime(currentRegime);
    this._regimeKnown = true;
    this._geoResolved = true;

    // The prior decision no longer applies; clear its stale SSR mirror so the
    // cookie-adopt step can't re-adopt it and silently undo the re-prompt.
    clearConsentCookie();

    if (currentRegime === 'opt_in') {
      // A prior silent grant / opt-out default can't count as GDPR opt-in.
      this._analytics = false;
      this._advertising = false;
      this._doNotSell = false;
      this._committedDoNotSell = false;
      const next: ConsentRecord = {
        decided: false,
        necessary: true,
        analytics: false,
        advertising: false,
      };
      this._consent = next;
      persistConsent(next);
      persistDoNotSell(false);
      pushConsentSignals({
        analytics: false,
        advertising: false,
        doNotSell: false,
      });
      dispatchConsentChange({
        consent: next,
        doNotSell: false,
        regime: currentRegime,
      });
      return;
    }

    // The only other stronger target is us_opt_out: re-show its notice while
    // keeping the opt-out default grant (subject to GPC), staying undecided.
    this.applyDefaultGrant(false, gpc);
  }

  // --- Render ---------------------------------------------------------------

  private renderAcceptDecline(): TemplateResult {
    return html`
      <div class="actions">
        <button type="button" class="btn" @click=${this.acceptAll}>
          Accept
        </button>
        <button type="button" class="btn" @click=${this.rejectAll}>
          Decline
        </button>
      </div>
    `;
  }

  private renderToggle(
    checked: boolean,
    label: string,
    onToggle: () => void,
    disabled = false,
  ): TemplateResult {
    return html`
      <button
        type="button"
        role="switch"
        class="toggle ${checked ? 'active' : ''}"
        aria-checked=${checked ? 'true' : 'false'}
        aria-label=${label}
        ?disabled=${disabled}
        aria-disabled=${disabled ? 'true' : 'false'}
        @click=${disabled ? undefined : onToggle}
      >
        <span class="toggle-thumb"></span>
      </button>
    `;
  }

  private renderPreferences(): TemplateResult {
    return html`
      <div
        id="cookie-preferences-panel"
        class="preferences"
        role="group"
        aria-label="Cookie preferences"
      >
        <div class="preference-row">
          <div class="preference-copy">
            <span class="preference-title">Strictly Necessary</span>
            <span class="preference-description">
              Required for the site to function securely. Always on.
            </span>
          </div>
          ${this.renderToggle(
            true,
            'Strictly necessary cookies (always on)',
            () => {},
            true,
          )}
        </div>

        <div class="preference-row">
          <div class="preference-copy">
            <span class="preference-title">Analytics / Performance</span>
            <span class="preference-description">
              Help us understand how the site is used so we can improve it.
            </span>
          </div>
          ${this.renderToggle(
            this._analytics,
            'Analytics and performance cookies',
            () => (this._analytics = !this._analytics),
          )}
        </div>

        <div class="preference-row">
          <div class="preference-copy">
            <span class="preference-title">Advertising / Marketing</span>
            <span class="preference-description">
              Used to measure and personalize our marketing.
            </span>
          </div>
          ${this.renderToggle(
            this._advertising,
            'Advertising and marketing cookies',
            () => (this._advertising = !this._advertising),
          )}
        </div>

        <button
          type="button"
          class="btn btn-secondary"
          @click=${this.savePreferences}
        >
          Save Preferences
        </button>
      </div>
    `;
  }

  private renderRegimeControls(): TemplateResult {
    if (this._regime === 'opt_in') {
      return html`
        <div class="regime-optin">
          <div
            class="preferences-wrapper ${this._showPreferences ? 'open' : ''}"
            ?inert=${!this._showPreferences}
          >
            <div class="preferences-clip">${this.renderPreferences()}</div>
          </div>
          <div class="actions">
            <button type="button" class="btn" @click=${this.acceptAll}>
              Accept All
            </button>
            <button type="button" class="btn" @click=${this.rejectAll}>
              Reject All
            </button>
            <button
              type="button"
              class="btn"
              aria-expanded=${this._showPreferences ? 'true' : 'false'}
              aria-controls="cookie-preferences-panel"
              @click=${() => this.togglePreferences()}
            >
              <span class="customize-label">
                Customize
                <svg
                  class="chevron ${this._showPreferences ? 'expanded' : ''}"
                  viewBox="0 0 24 24"
                  width="28"
                  height="28"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 15l6-6 6 6" />
                </svg>
              </span>
            </button>
          </div>
        </div>
      `;
    }

    if (this._regime === 'us_opt_out') {
      return html`
        <div class="do-not-sell">
          <span id="do-not-sell-label" class="do-not-sell-label">
            Do not sell or share my personal information.
          </span>
          ${this.renderToggle(
            this._doNotSell,
            'Do not sell or share my personal information',
            () => (this._doNotSell = !this._doNotSell),
          )}
        </div>
        ${this.renderAcceptDecline()}
      `;
    }

    return this.renderAcceptDecline();
  }

  render(): typeof nothing | TemplateResult {
    const decided = this._consent?.decided ?? false;
    const isOptIn = this._regime === 'opt_in';
    const isOptOut = this._regime === 'us_opt_out';
    const showFirstLoad =
      this._mounted && this._geoResolved && (isOptIn || isOptOut) && !decided;

    if (!showFirstLoad && !this._visible) {
      return nothing;
    }

    return html`
      <div class="notice" role="dialog" aria-label="Cookie policy and consent">
        <div class="stack">
          <div class="copy">
            <span class="eyebrow">Cookie Policy</span>
            <p class="body">
              We use necessary cookies to make our site work. With your
              permission, we also use optional cookies to analyze site usage and
              assist in our marketing efforts. Read more in our
              <a href=${this.policyUrl} class="link">cookie policy</a>.
            </p>
          </div>
          ${this.renderRegimeControls()}
        </div>
      </div>
    `;
  }

  static styles = css`
    :host {
      /* --- Theming tokens (override from :root / host to reskin per property) --- */
      --tcb-bg: #07090d;
      --tcb-text: #92a4c3;
      --tcb-muted: #93a1b8;
      --tcb-title: #f5f7fa;
      --tcb-eyebrow: #7f86f1;
      --tcb-heading: #a5b4fc;
      --tcb-accent: #6366f1;
      --tcb-link: #a5b4fc;
      --tcb-toggle-off: #3a3f4b;
      /* Primary buttons mirror the temporal.io "primary / green" button:
         a green gradient fill with near-black monospace text. */
      --tcb-btn-bg: linear-gradient(255deg, #1ff1a5 0%, #c3ff62 100%);
      --tcb-btn-bg-active:
        linear-gradient(0deg, rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0.2)),
        linear-gradient(255deg, #1ff1a5 0%, #c3ff62 100%);
      --tcb-btn-text: #141414;
      --tcb-btn-ring: rgba(89, 253, 160, 0.7);
      /* Secondary buttons mirror "secondary / green": space-black fill with a
         green gradient border. Hover uses the shared --tcb-btn-ring, identical
         to the primary buttons. */
      --tcb-btn-secondary-bg: #141414;
      --tcb-btn-secondary-text: #ffffff;
      --tcb-btn-secondary-border: linear-gradient(45deg, #1ff1a5, #c3ff62);
      --tcb-radius: 0px;
      --tcb-padding: 1.25rem;
      --tcb-max-width: 42rem;
      --tcb-font: inherit;
      /* Document-level @font-face fonts (e.g. Noto Sans Mono, loaded by
         temporal.io) are usable inside shadow DOM; the system stack is the
         self-contained fallback elsewhere. */
      --tcb-font-mono:
        'Noto Sans Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      --tcb-offset: 1.25rem;

      position: fixed;
      right: var(--tcb-offset);
      bottom: var(--tcb-offset);
      z-index: 2147483000;
      max-width: var(--tcb-max-width);
      font-family: var(--tcb-font);
    }

    .notice {
      background: var(--tcb-bg);
      color: var(--tcb-text);
      border-radius: var(--tcb-radius);
      padding: var(--tcb-padding);
    }

    .stack {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .copy {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .eyebrow {
      font-family: var(--tcb-font-mono);
      font-size: 0.875rem;
      font-weight: 300;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--tcb-eyebrow);
    }

    .body {
      margin: 0;
      font-size: 0.875rem;
      font-weight: 300;
      line-height: 1.5;
      letter-spacing: 0.01em;
      color: var(--tcb-text);
    }

    .link {
      color: inherit;
      text-decoration: underline;
    }

    .actions {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      width: 100%;
    }

    @media (min-width: 640px) {
      .actions {
        flex-direction: row;
        gap: 1rem;
      }
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      box-sizing: border-box;
      height: 2.75rem;
      padding: 0 1rem;
      font-family: var(--tcb-font-mono);
      font-weight: 500;
      font-size: 0.875rem;
      line-height: 1;
      cursor: pointer;
      border: none;
      border-radius: var(--tcb-radius);
      background: var(--tcb-btn-bg);
      color: var(--tcb-btn-text);
      transition: box-shadow 0.15s ease-in-out;
      appearance: none;
    }

    /* Original Button font: text-sm (14px) on mobile, text-base (16px) at
       >= 640px. Declared after the base .btn so it wins the equal-specificity
       cascade at desktop widths. */
    @media (min-width: 640px) {
      .btn {
        font-size: 1rem;
      }
    }

    /* Equal-width buttons only within the horizontal actions row. Applying
       flex-grow to the base .btn would collapse the Save Preferences button's
       height inside the column-direction .preferences container (flex-basis: 0
       on the main axis overrides the fixed height). */
    .actions .btn {
      flex: 1 1 0;
    }

    .btn:hover {
      box-shadow: 0 0 0 4px var(--tcb-btn-ring);
    }

    .btn:not(.btn-secondary):active {
      background: var(--tcb-btn-bg-active);
    }

    .btn-secondary {
      border: 2px solid transparent;
      background:
        linear-gradient(
            var(--tcb-btn-secondary-bg),
            var(--tcb-btn-secondary-bg)
          )
          padding-box,
        var(--tcb-btn-secondary-border) border-box;
      color: var(--tcb-btn-secondary-text);
    }

    .btn:focus-visible,
    .toggle:focus-visible {
      outline: 2px solid var(--tcb-accent);
      outline-offset: 2px;
    }

    .customize-label {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
    }

    .chevron {
      transition: transform 0.2s ease-in-out;
    }

    .chevron.expanded {
      transform: rotate(180deg);
    }

    .regime-optin {
      display: flex;
      flex-direction: column;
    }

    /* Slide the preference center open/closed. The grid 0fr→1fr trick animates
       to the panel's natural height (the equivalent of Svelte's <slide>); the
       inner clip element hides the overflow during the transition. */
    .preferences-wrapper {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 250ms ease;
    }

    .preferences-wrapper.open {
      grid-template-rows: 1fr;
    }

    /* Inline padding + matching negative margin lets the Save Preferences hover
       ring escape horizontally: overflow: hidden (needed to clip the slide-open
       animation) would otherwise crop the ring's left/right edges since the
       button is full-width. The negative margin re-expands the clip into the
       banner's own padding so nothing shifts visually. */
    .preferences-clip {
      overflow: hidden;
      min-height: 0;
      padding-inline: 6px;
      margin-inline: -6px;
    }

    @media (prefers-reduced-motion: reduce) {
      .preferences-wrapper {
        transition: none;
      }
    }

    .preferences {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      width: 100%;
      padding-bottom: 1rem;
    }

    .preference-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      width: 100%;
    }

    .preference-copy {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }

    .preference-title {
      font-size: 0.875rem;
      font-weight: 300;
      color: var(--tcb-title);
    }

    .preference-description {
      font-size: 0.75rem;
      font-weight: 300;
      color: var(--tcb-muted);
    }

    .do-not-sell {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
    }

    @media (min-width: 640px) {
      .do-not-sell {
        flex-direction: row-reverse;
        justify-content: flex-end;
      }
    }

    .do-not-sell-label {
      font-size: 0.75rem;
      font-weight: 300;
      color: var(--tcb-muted);
    }

    .toggle {
      position: relative;
      display: inline-flex;
      flex-shrink: 0;
      height: 1.25rem;
      width: 2.25rem;
      padding: 0;
      cursor: pointer;
      border: none;
      border-radius: 9999px;
      background: var(--tcb-toggle-off);
      transition: background-color 0.2s ease-in-out;
    }

    .toggle.active {
      background: var(--tcb-accent);
    }

    .toggle:disabled {
      cursor: not-allowed;
      opacity: 0.7;
    }

    .toggle-thumb {
      pointer-events: none;
      display: inline-block;
      height: 1rem;
      width: 1rem;
      transform: translate(0.125rem, 0.125rem);
      border-radius: 9999px;
      background: #ffffff;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      transition: transform 0.2s ease-in-out;
    }

    .toggle.active .toggle-thumb {
      transform: translate(1.125rem, 0.125rem);
    }
  `;
}

export const ELEMENT_NAME = 'temporal-cookie-banner';

// Register only in the browser: importing this module during SSR (e.g. from a
// SvelteKit layout) must not touch `customElements`, which doesn't exist on the
// server. Also guard against double registration — the bundle could be loaded
// twice, or the ESM and IIFE builds could both be present on a page, and
// re-defining a name throws.
if (
  typeof customElements !== 'undefined' &&
  !customElements.get(ELEMENT_NAME)
) {
  customElements.define(ELEMENT_NAME, TemporalCookieBanner);
}

declare global {
  interface HTMLElementTagNameMap {
    'temporal-cookie-banner': TemporalCookieBanner;
  }
}
