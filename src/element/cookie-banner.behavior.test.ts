import { afterEach, describe, expect, it, vi } from "vitest";
// Importing the element registers the custom element as a side effect.
import { ELEMENT_NAME, type TemporalCookieBanner } from "./cookie-banner";
import { CONSENT_CHANGE_EVENT } from "./consent-sync";
import type { ConsentRecord } from "../core/consent";
import type { ConsentRegime } from "../core/consent-region";

const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

// Deterministically resolve the element's `/api/geo` fetch to a chosen regime,
// bypassing the network so first-load behavior is testable in jsdom.
const mockGeo = (regime: ConsentRegime, gpc = false): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ regime, gpc }),
    }),
  );
};

// Append the element and wait for the async geo resolution + the render it
// schedules (two macrotasks drain the fetch().json() microtask chain).
const mount = async (): Promise<TemporalCookieBanner> => {
  const el = document.createElement(ELEMENT_NAME) as TemporalCookieBanner;
  document.body.append(el);
  await tick();
  await tick();
  await el.updateComplete;
  return el;
};

const buttons = (el: TemporalCookieBanner): HTMLButtonElement[] =>
  Array.from(el.shadowRoot?.querySelectorAll("button") ?? []);

const buttonByText = (
  el: TemporalCookieBanner,
  text: string,
): HTMLButtonElement | undefined =>
  buttons(el).find((b) => b.textContent?.trim() === text);

// Resolve with the first message posted on persistStore's channel for `key`.
// A separate BroadcastChannel instance receives the element's post (a channel
// never receives its own messages).
const nextBroadcast = <T>(key: string): Promise<T> =>
  new Promise((resolve) => {
    const channel = new BroadcastChannel(`persist-store-${key}`);
    channel.addEventListener("message", (event) => {
      resolve(event.data as T);
      channel.close();
    });
  });

const readConsent = (): ConsentRecord | null =>
  JSON.parse(localStorage.getItem("consent") ?? "null") as ConsentRecord | null;

afterEach(() => {
  document.querySelectorAll(ELEMENT_NAME).forEach((el) => el.remove());
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = "consent=; path=/; max-age=0";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as unknown as { gtag?: unknown }).gtag;
  delete (window as unknown as { dataLayer?: unknown }).dataLayer;
});

describe("TemporalCookieBanner rendering by regime", () => {
  it("shows the opt_in notice with Accept All / Reject All / Customize", async () => {
    mockGeo("opt_in");
    const el = await mount();

    expect(el.shadowRoot?.querySelector(".notice")).not.toBeNull();
    expect(buttonByText(el, "Accept All")).toBeTruthy();
    expect(buttonByText(el, "Reject All")).toBeTruthy();
    expect(buttons(el).some((b) => b.textContent?.includes("Customize"))).toBe(
      true,
    );
    // No CCPA control in opt_in — advertising toggle covers sale/share.
    expect(el.shadowRoot?.querySelector(".do-not-sell")).toBeNull();
  });

  it("stays silent and grants by default for us_basic", async () => {
    mockGeo("us_basic");
    const el = await mount();

    // us_basic is a silent grant: no notice renders, decision is recorded.
    expect(el.shadowRoot?.querySelector(".notice")).toBeNull();
    expect(readConsent()).toMatchObject({
      decided: true,
      analytics: true,
      advertising: true,
    });
  });

  it("shows the CCPA Do Not Sell notice for us_opt_out", async () => {
    mockGeo("us_opt_out");
    const el = await mount();

    expect(el.shadowRoot?.querySelector(".do-not-sell")).not.toBeNull();
    expect(buttonByText(el, "Accept")).toBeTruthy();
    expect(buttonByText(el, "Decline")).toBeTruthy();
  });
});

// Element-level integration guard: a real Accept click must drive ALL five
// propagation channels. The module-level fan-out is covered in
// consent-sync.test.ts; this proves the element is wired to it.
describe("TemporalCookieBanner Accept fan-out", () => {
  it("writes localStorage + cookie + gtag + broadcast + consentchange", async () => {
    mockGeo("opt_in");
    const el = await mount();

    const gtag = vi.fn();
    (window as unknown as { gtag: unknown }).gtag = gtag;
    (window as unknown as { dataLayer: unknown[] }).dataLayer = [];

    const onConsentChange = vi.fn();
    window.addEventListener(CONSENT_CHANGE_EVENT, onConsentChange);
    const broadcast = nextBroadcast<ConsentRecord>("consent");

    buttonByText(el, "Accept All")?.click();

    // 1. localStorage (persistStore format)
    expect(readConsent()).toMatchObject({
      decided: true,
      analytics: true,
      advertising: true,
    });
    // 2. SSR-readable cookie mirror
    expect(document.cookie).toContain("consent=");
    // 3. Google Consent Mode signal
    expect(gtag).toHaveBeenCalledWith(
      "consent",
      "update",
      expect.objectContaining({
        analytics_storage: "granted",
        ad_storage: "granted",
      }),
    );
    // 4. Host `consentchange` event (Amplitude re-bucketing bridge)
    expect(onConsentChange).toHaveBeenCalledOnce();
    // 5. BroadcastChannel fan-out to live consumers (Marketo embed)
    await expect(broadcast).resolves.toMatchObject({
      decided: true,
      analytics: true,
      advertising: true,
    });

    window.removeEventListener(CONSENT_CHANGE_EVENT, onConsentChange);
  });
});

// The regime endpoint is configurable. It defaults to the canonical absolute
// endpoint (consent.temporal.io/api/geo) so every embedding host resolves
// consent from one source; a host with its own same-origin `/api/geo` route can
// override via the `geo-endpoint` attribute.
describe("TemporalCookieBanner geo-endpoint", () => {
  // Mock fetch capturing the requested URL while resolving a regime, so we can
  // assert which endpoint the element called.
  const captureGeoFetch = (): ReturnType<typeof vi.fn> => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ regime: "opt_in", gpc: false }),
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  const firstFetchUrl = (fetchMock: ReturnType<typeof vi.fn>): string =>
    String(fetchMock.mock.calls[0]?.[0]);

  it("defaults to the canonical consent.temporal.io/api/geo endpoint", async () => {
    const fetchMock = captureGeoFetch();
    await mount();

    expect(fetchMock).toHaveBeenCalledOnce();
    const requested = new URL(firstFetchUrl(fetchMock));
    expect(requested.origin).toBe("https://consent.temporal.io");
    expect(requested.pathname).toBe("/api/geo");
  });

  it("routes to a same-origin route set via the geo-endpoint attribute", async () => {
    const fetchMock = captureGeoFetch();
    const el = document.createElement(ELEMENT_NAME) as TemporalCookieBanner;
    el.setAttribute("geo-endpoint", "/api/geo");
    document.body.append(el);
    await tick();
    await tick();
    await el.updateComplete;

    expect(fetchMock).toHaveBeenCalledOnce();
    const requested = new URL(firstFetchUrl(fetchMock));
    expect(requested.origin).toBe(window.location.origin);
    expect(requested.pathname).toBe("/api/geo");
  });
});
