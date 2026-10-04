import {
  blogDraftsQuery,
  blogPostBody,
  blogSlugParams,
} from "@/lib/api/typebox/blog";
import { LOCALES, msg } from "@/lib/config/constants";
import { dayjs } from "@/lib/utils/format/date";
import { Elysia, type Context } from "elysia";
import { checkPublisher, type PublisherCheck } from "./publisher.service";
import {
  deletePost,
  getPost,
  isRegistrySlug,
  listPosts,
  putPost,
} from "./posts.service";

const PUBLISHER_REFUSAL = {
  disabled: [503, msg("ERRORS.BLOG_PUBLISHING_DISABLED")],
  unavailable: [503, msg("ERRORS.BLOG_PUBLISHER_CHECK_FAILED")],
  unauthorized: [401, msg("ERRORS.UNAUTHORIZED")],
  forbidden: [403, msg("ERRORS.BLOG_NOT_A_PUBLISHER")],
} as const;

const LOCALE_SET: ReadonlySet<string> = new Set(LOCALES);

// A transform hook, so it runs BEFORE body validation: an anonymous or
// misconfigured write learns 401/503, never the schema. Only unparseable JSON
// is answered earlier (400), by the parser.
function requirePublisher({
  publisher,
  status,
}: Pick<Context, "status"> & { publisher: PublisherCheck | null }) {
  if (publisher === "publisher") return;
  const [code, message] = PUBLISHER_REFUSAL[publisher ?? "unauthorized"];
  throw status(code, { success: false, message });
}

// Elysia's normalize strips unknown keys before Check, so a misspelled locale
// would vanish without an error; refuse it while the raw body is still here.
function rejectUnknownLocales(ctx: Pick<Context, "body" | "status">) {
  const body: unknown = ctx.body;
  if (typeof body !== "object" || body === null || !("translations" in body))
    return;
  const { translations } = body;
  if (typeof translations !== "object" || translations === null) return;
  const unknown = Object.keys(translations).find((k) => !LOCALE_SET.has(k));
  if (unknown !== undefined)
    throw ctx.status(422, {
      success: false,
      message: msg("ERRORS.BLOG_UNKNOWN_LOCALE"),
      params: { locale: unknown },
    });
}

// The schema pattern admits 2026-02-31; the calendar does not.
function isCalendarDate(date: string): boolean {
  return dayjs.utc(date).format("YYYY-MM-DD") === date;
}

export const postsRoute = new Elysia({ prefix: "/posts" })
  // Derive, not resolve: resolve runs after validation, and writes must be
  // refused before it. A read checks only when it asks for ?drafts=1, so an
  // anonymous read never costs a gateway call, whatever headers it sends.
  .derive(async ({ request }) => ({
    publisher:
      request.method === "GET" &&
      new URL(request.url).searchParams.get("drafts") !== "1"
        ? null
        : await checkPublisher(request),
  }))

  .get(
    "/",
    async ({ publisher }) => {
      const data = await listPosts(publisher === "publisher");
      return { success: true, data };
    },
    { query: blogDraftsQuery },
  )

  .get(
    "/:slug",
    async ({ params, publisher, status }) => {
      const data = await getPost(params.slug, publisher === "publisher");
      if (!data)
        return status(404, {
          success: false,
          message: msg("ERRORS.NOT_FOUND"),
        });
      return { success: true, data };
    },
    { params: blogSlugParams, query: blogDraftsQuery },
  )

  .put(
    "/:slug",
    async ({ params, body, status }) => {
      if (isRegistrySlug(params.slug))
        return status(409, {
          success: false,
          message: msg("ERRORS.BLOG_SLUG_TAKEN"),
        });
      if (!isCalendarDate(body.date))
        return status(422, {
          success: false,
          message: msg("ERRORS.BLOG_INVALID_DATE"),
          params: { date: body.date },
        });
      const data = await putPost(params.slug, body);
      return { success: true, data };
    },
    {
      params: blogSlugParams,
      body: blogPostBody,
      transform: [requirePublisher, rejectUnknownLocales],
    },
  )

  .delete(
    "/:slug",
    async ({ params }) => {
      const data = await deletePost(params.slug);
      return { success: true, data };
    },
    { params: blogSlugParams, transform: requirePublisher },
  );
