import { ParamError } from "@/lib/types";

const blogPublisherIdEntries = (process.env.BLOG_PUBLISHER_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const isPublisherId = (id: string) => /^[1-9]\d*$/.test(id);

export const serverEnv = {
  sessionSecret: process.env.SESSION_SECRET ?? "",
  // Cookies sealed before a rotation keep verifying until they expire (30d).
  sessionSecretPrevious: process.env.SESSION_SECRET_PREVIOUS ?? "",
  guestApiKey: process.env.GUEST_API_KEY,
  runwareApiKey: process.env.RUNWARE_API_KEY,
  internalApiUrl: process.env.INTERNAL_API_URL,
  // Lets a laptop BFF through the edge rules that challenge credential-less /api calls.
  edgeDevToken: process.env.EDGE_DEV_TOKEN ?? "",
  edgeSessionSecret: process.env.EDGE_SESSION_SECRET ?? "",
  // Proves to the gateway that a key resolution came from this server, not a
  // browser, so it is not audited as a human reveal. Optional: without it the
  // gateway simply keeps logging.
  bffServiceToken: process.env.BFF_SERVICE_TOKEN ?? "",
  // Cluster-internal Discord bot. Serves the live reward amounts; no public ingress.
  botInternalUrl: process.env.BOT_INTERNAL_URL ?? "http://unorouter-bot:4000",
  tursoUrl: process.env.TURSO_DATABASE_URL,
  tursoToken: process.env.TURSO_AUTH_TOKEN,
  tavilyApiKey: process.env.TAVILY_API_KEY,
  // Who may write /api/blog/posts. Either is enough; with neither the write
  // endpoints answer 503. The token is a shared secret sent as a Bearer; the ids
  // are UnoRouter users verified against the gateway with their access token.
  blogPublishToken: process.env.BLOG_PUBLISH_TOKEN?.trim() ?? "",
  blogPublisherIds: blogPublisherIdEntries.filter(isPublisherId).map(Number),
  // Purge-by-URL after a blog write so the edge stops serving the old page.
  // Optional: without it a change shows once the edge TTL runs out.
  cloudflarePurgeToken: process.env.CLOUDFLARE_PURGE_TOKEN ?? "",
  cloudflareZoneId: process.env.CLOUDFLARE_ZONE_ID ?? "",
  standalone: process.env.STANDALONE,
} as const;

if (typeof window === "undefined" && !process.env.NEXT_PHASE) {
  if (!serverEnv.sessionSecret)
    throw new ParamError("ERRORS.MISSING_ENV", { var: "SESSION_SECRET" });
  if (serverEnv.sessionSecret.length < 32)
    throw new Error(
      "SESSION_SECRET too short (iron-session needs >= 32 chars)",
    );
}

if (typeof globalThis !== "undefined" && !process.env.NEXT_PHASE) {
  const warnings: string[] = [];
  if (!serverEnv.guestApiKey)
    warnings.push("GUEST_API_KEY (guest chat disabled)");
  if (!serverEnv.edgeSessionSecret)
    warnings.push(
      "EDGE_SESSION_SECRET (logged-in users get no edge exemption)",
    );
  if (!serverEnv.tavilyApiKey)
    warnings.push("TAVILY_API_KEY (web search disabled)");
  if (!serverEnv.tursoUrl)
    warnings.push("TURSO_DATABASE_URL (database disabled)");
  if (!serverEnv.blogPublishToken && serverEnv.blogPublisherIds.length === 0)
    warnings.push(
      "BLOG_PUBLISH_TOKEN / BLOG_PUBLISHER_IDS (blog publishing disabled)",
    );
  const badPublisherIds = blogPublisherIdEntries.filter(
    (id) => !isPublisherId(id),
  );
  if (badPublisherIds.length > 0)
    console.warn(
      `[env] BLOG_PUBLISHER_IDS ignores entries that are not user ids: ${badPublisherIds.join(", ")}`,
    );
  if (!serverEnv.cloudflarePurgeToken || !serverEnv.cloudflareZoneId)
    warnings.push(
      "CLOUDFLARE_PURGE_TOKEN / CLOUDFLARE_ZONE_ID (blog edits wait for the edge TTL)",
    );
  if (warnings.length > 0)
    console.warn(`[env] Missing optional vars: ${warnings.join(", ")}`);
}
