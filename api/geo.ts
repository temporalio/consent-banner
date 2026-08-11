import { resolveConsentRegime } from "../src/core/consent-region";

// This endpoint is the canonical consent-regime resolver for every Temporal web
// property. Unlike the former same-origin SvelteKit route, it is ALWAYS called
// cross-origin (the banner runs on temporal.io / docs / learn / pages and fetches
// consent.temporal.io), so every response carries scoped CORS headers.
//
// Edge runtime: it only reads request headers and does pure computation, so Edge
// gives the lowest latency and cheapest cold starts. Vercel populates the
// `x-vercel-ip-*` geolocation headers on every deployed request.
export const config = { runtime: "edge" };

// Cross-origin access is scoped to Temporal properties: the apex and any
// `*.temporal.io` subdomain. `localhost` is allowed only outside production so
// the component can be exercised locally, never on the live endpoint.
const TEMPORAL_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*temporal\.io$/;
const LOCALHOST_ORIGIN = /^http:\/\/localhost(:\d+)?$/;

// VERCEL_ENV is 'production' | 'preview' | 'development' (undefined under a plain
// local run). Testing overrides and localhost CORS are honored everywhere except
// production, where only the real per-request edge headers are trusted.
const isProduction = process.env.VERCEL_ENV === "production";

/**
 * Returns CORS headers echoing the request Origin only when it is a trusted
 * Temporal property. The response carries no cookies or credentials (it reads
 * only edge geo/GPC request headers), so a validated echo with `Vary: Origin`
 * is safe and never a wildcard with credentials.
 */
const corsHeaders = (origin: string | null): Record<string, string> => {
  if (
    origin &&
    (TEMPORAL_ORIGIN.test(origin) ||
      (!isProduction && LOCALHOST_ORIGIN.test(origin)))
  ) {
    return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  }
  return {};
};

/**
 * Resolves the visitor's consent regime from Vercel's edge geolocation headers
 * (country and, for the US, region/state), plus whether the visitor is sending a
 * Global Privacy Control signal. The response is per-visitor and must never be
 * shared across users, hence `private, no-store`.
 */
export default function handler(request: Request): Response {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");

  const headerCountry = request.headers.get("x-vercel-ip-country");
  const headerRegion = request.headers.get("x-vercel-ip-country-region");
  // GPC is sent as the standardized `Sec-GPC: 1` request header by every
  // supporting browser — the canonical, server-visible opt-out-of-sale signal.
  const headerGpc = request.headers.get("sec-gpc") === "1";

  // Local dev and preview have no real edge geo headers, so allow
  // `?country=US&region=CA&gpc=1` overrides to exercise every regime and the GPC
  // path. Production ignores the params and trusts only the per-request headers.
  const country = !isProduction
    ? (url.searchParams.get("country") ?? headerCountry)
    : headerCountry;
  const region = !isProduction
    ? (url.searchParams.get("region") ?? headerRegion)
    : headerRegion;
  const gpcOverride = url.searchParams.get("gpc");
  const gpc =
    !isProduction && gpcOverride !== null
      ? gpcOverride === "1" || gpcOverride === "true"
      : headerGpc;

  return new Response(
    JSON.stringify({
      country,
      region,
      regime: resolveConsentRegime(country, region),
      gpc,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        ...corsHeaders(origin),
      },
    },
  );
}
