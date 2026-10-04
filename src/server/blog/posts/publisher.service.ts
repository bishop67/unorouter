import { NEW_API_USER } from "@/lib/config/constants";
import { isUpstreamError } from "@/lib/custom-fetch";
import { unwrap } from "@/lib/utils/base";
import { getSelf } from "@/openapi";
import { deriveUpstream } from "@/server/constants";
import { serverEnv } from "@/server/env";
import { t, type Static } from "elysia";
import { createHash, timingSafeEqual } from "node:crypto";

export const publisherCheck = t.Union([
  t.Literal("publisher"),
  t.Literal("disabled"),
  t.Literal("unauthorized"),
  t.Literal("forbidden"),
  t.Literal("unavailable"),
]);
export type PublisherCheck = Static<typeof publisherCheck>;

// The gateway's own client waits 30s; a publisher check must not.
const GATEWAY_TIMEOUT_MS = 5000;

export function publishingEnabled(): boolean {
  return (
    !!serverEnv.tursoUrl &&
    (!!serverEnv.blogPublishToken || serverEnv.blogPublisherIds.length > 0)
  );
}

// Digests first: timingSafeEqual throws on unequal lengths, and comparing raw
// lengths would leak the token's.
function isStaticToken(credential: string): boolean {
  if (!serverEnv.blogPublishToken) return false;
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(
    digest(credential),
    digest(serverEnv.blogPublishToken),
  );
}

// ONE gateway call, and only for a request that names a user. null: the
// gateway refused the token (401/403); "unavailable": it could not say (5xx,
// 429, 408, any other status, a timeout), which is not the caller's fault.
async function selfId(
  request: Request,
  authorization: string,
  userHeader: string,
): Promise<number | null | "unavailable"> {
  const { upstream } = await deriveUpstream({ request });
  // An explicit token makes customFetch skip cookies; a forwarded session
  // cookie would let the gateway authenticate someone else than the token.
  delete upstream.headers.cookie;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"unavailable">((done) => {
    timer = setTimeout(() => done("unavailable"), GATEWAY_TIMEOUT_MS);
  });
  const lookup = getSelf({
    headers: {
      ...upstream.headers,
      Authorization: authorization,
      [NEW_API_USER]: userHeader,
    },
  })
    .then((res) => unwrap(res).data?.id ?? null)
    .catch((err: unknown) =>
      isUpstreamError(err) && (err.status === 401 || err.status === 403)
        ? null
        : "unavailable",
    );
  return Promise.race([lookup, timeout]).finally(() => clearTimeout(timer));
}

export async function checkPublisher(
  request: Request,
): Promise<PublisherCheck> {
  if (!publishingEnabled()) return "disabled";
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (!authorization) return "unauthorized";
  // The scheme is case-insensitive (RFC 9110). The static token under any
  // scheme, or none, is answered here and never reaches the gateway.
  const parts = /^(\S+)\s+(.+)$/.exec(authorization);
  const credential = parts?.[2]?.trim() ?? authorization;
  if (isStaticToken(credential) || isStaticToken(authorization))
    return parts?.[1]?.toLowerCase() === "bearer"
      ? "publisher"
      : "unauthorized";

  const userHeader = request.headers.get(NEW_API_USER) ?? "";
  if (serverEnv.blogPublisherIds.length === 0 || !userHeader)
    return "unauthorized";
  const id = await selfId(request, authorization, userHeader);
  if (id === "unavailable") return "unavailable";
  if (id === null) return "unauthorized";
  return serverEnv.blogPublisherIds.includes(id) ? "publisher" : "forbidden";
}
