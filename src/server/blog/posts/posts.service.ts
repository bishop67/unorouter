import type {
  BlogPostBody,
  BlogPostDto,
  BlogPostSummaryDto,
  BlogPostTranslations,
} from "@/lib/api/typebox/blog";
import { blogPosts } from "@/lib/db/schema/blog";
import type { BlogPostRow } from "@/lib/db/schema/rows";
import { getMigratedDb } from "@/lib/db/server/client";
import { getPathname } from "@/i18n/navigation";
import { BLOG_REGISTRY } from "@/i18n/registry";
import { routing } from "@/i18n/routing";
import { env } from "@/lib/config/env";
import { safeFetchRaw } from "@/lib/config/safe-fetch";
import { errMessage } from "@/lib/utils/base";
import { dayjs } from "@/lib/utils/format/date";
import { logger } from "@/lib/utils/logger";
import { serverEnv } from "@/server/env";
import { and, desc, eq, lte, notInArray, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Locale } from "next-intl";

// Cloudflare's purge-by-URL limit per call on every plan below Enterprise.
const PURGE_BATCH = 30;

const REGISTRY_SLUGS: readonly string[] = BLOG_REGISTRY.map((p) => p.slug);
const REGISTRY_SLUG_SET: ReadonlySet<string> = new Set(REGISTRY_SLUGS);

// THE visibility rule for a stored post, used by every public reader (blog
// pages, feed, sitemap, llms.txt, anonymous API): published, dated today or
// earlier, and not shadowed by a registry post. The clock, not the build date
// the registry uses: these posts are written after the deploy.
function publiclyVisible(): SQL {
  return and(
    eq(blogPosts.status, "published"),
    lte(blogPosts.date, dayjs.utc().format("YYYY-MM-DD")),
    notInArray(blogPosts.slug, [...REGISTRY_SLUGS]),
  )!;
}

// A translated field when the post has that locale, else the base text.
function localized(
  column: SQLiteColumn,
  field: "title" | "description" | "body",
  locale: Locale,
) {
  return sql<string>`coalesce(json_extract(${blogPosts.translations}, ${`$."${locale}".${field}`}), ${column})`;
}

// What a list reader needs: never a body, never the other locales' texts.
function cardColumns(locale: Locale) {
  return {
    slug: blogPosts.slug,
    date: blogPosts.date,
    tags: blogPosts.tags,
    category: blogPosts.category,
    author: blogPosts.author,
    heroImage: blogPosts.heroImage,
    wordCounts: blogPosts.wordCounts,
    updatedAt: blogPosts.updatedAt,
    title: localized(blogPosts.title, "title", locale),
    description: localized(blogPosts.description, "description", locale),
  };
}

function toDto(row: BlogPostRow): BlogPostDto {
  const { wordCounts: _, ...rest } = row;
  return {
    ...rest,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

// Registry slugs win on the post page, so a stored copy would never be shown.
export function isRegistrySlug(slug: string): boolean {
  return REGISTRY_SLUG_SET.has(slug);
}

// No database means no stored posts, not an error: the blog still renders the
// registry.
export async function listVisiblePosts(locale: Locale) {
  if (!serverEnv.tursoUrl) return [];
  const db = await getMigratedDb();
  return db
    .select(cardColumns(locale))
    .from(blogPosts)
    .where(publiclyVisible())
    .orderBy(desc(blogPosts.date), desc(blogPosts.createdAt));
}

export async function getVisiblePost(slug: string, locale: Locale) {
  if (!serverEnv.tursoUrl) return null;
  const db = await getMigratedDb();
  const rows = await db
    .select({
      ...cardColumns(locale),
      body: localized(blogPosts.body, "body", locale),
    })
    .from(blogPosts)
    .where(and(eq(blogPosts.slug, slug), publiclyVisible()))
    .limit(1);
  return rows[0] ?? null;
}

// API list: summaries only, bodies come from GET /:slug. A publisher also sees
// drafts and scheduled posts.
export async function listPosts(
  includeHidden: boolean,
): Promise<BlogPostSummaryDto[]> {
  if (!serverEnv.tursoUrl) return [];
  const db = await getMigratedDb();
  const rows = await db
    .select({
      id: blogPosts.id,
      slug: blogPosts.slug,
      title: blogPosts.title,
      description: blogPosts.description,
      tags: blogPosts.tags,
      category: blogPosts.category,
      date: blogPosts.date,
      author: blogPosts.author,
      status: blogPosts.status,
      heroImage: blogPosts.heroImage,
      wordCounts: blogPosts.wordCounts,
      createdAt: blogPosts.createdAt,
      updatedAt: blogPosts.updatedAt,
    })
    .from(blogPosts)
    .where(includeHidden ? undefined : publiclyVisible())
    .orderBy(desc(blogPosts.date), desc(blogPosts.createdAt));
  return rows.map(({ wordCounts, ...row }) => ({
    ...row,
    locales: Object.keys(wordCounts) as Locale[],
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }));
}

export async function getPost(slug: string, includeHidden: boolean) {
  if (!serverEnv.tursoUrl) return null;
  const db = await getMigratedDb();
  const rows = await db
    .select()
    .from(blogPosts)
    .where(
      and(
        eq(blogPosts.slug, slug),
        includeHidden ? undefined : publiclyVisible(),
      ),
    )
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

type BlogDb = Awaited<ReturnType<typeof getMigratedDb>>;
type BlogTx = Parameters<Parameters<BlogDb["transaction"]>[0]>[0];

// Read inside the write's transaction, so the purge decision sees exactly the
// row before and after it (the rule stays the SQL one above).
async function isPublic(tx: BlogTx, slug: string): Promise<boolean> {
  const rows = await tx
    .select({ slug: blogPosts.slug })
    .from(blogPosts)
    .where(and(eq(blogPosts.slug, slug), publiclyVisible()))
    .limit(1);
  return rows.length > 0;
}

// Word-like segments, so CJK text without spaces is counted in words rather
// than as one per paragraph.
function countWords(text: string, locale: Locale): number {
  let count = 0;
  const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
  for (const segment of segmenter.segment(text))
    if (segment.isWordLike) count++;
  return count;
}

export async function putPost(
  slug: string,
  body: BlogPostBody,
): Promise<BlogPostDto> {
  const translations: BlogPostTranslations | null = body.translations ?? null;
  const wordCounts: BlogPostRow["wordCounts"] = {
    [routing.defaultLocale]: countWords(body.body, routing.defaultLocale),
  };
  for (const locale of routing.locales) {
    const text = translations?.[locale];
    if (text) wordCounts[locale] = countWords(text.body, locale);
  }
  const values = {
    ...body,
    heroImage: body.heroImage ?? null,
    translations,
    wordCounts,
  };
  // Milliseconds from here: the column default is SQL second precision, too
  // coarse to tell a delete-and-recreate within one second apart.
  const now = dayjs().toDate();
  const db = await getMigratedDb();
  const { row, purge } = await db.transaction(async (tx) => {
    const wasPublic = await isPublic(tx, slug);
    const rows = await tx
      .insert(blogPosts)
      .values({ slug, ...values, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: blogPosts.slug,
        set: { ...values, updatedAt: now },
      })
      .returning();
    return { row: rows[0]!, purge: wasPublic || (await isPublic(tx, slug)) };
  });
  if (purge) void purgeBlogPages(slug);
  return toDto(row);
}

export async function deletePost(slug: string): Promise<{ deleted: boolean }> {
  const db = await getMigratedDb();
  const { deleted, wasPublic } = await db.transaction(async (tx) => {
    const wasPublic = await isPublic(tx, slug);
    const rows = await tx
      .delete(blogPosts)
      .where(eq(blogPosts.slug, slug))
      .returning({ id: blogPosts.id });
    return { deleted: rows.length > 0, wasPublic };
  });
  if (wasPublic) void purgeBlogPages(slug);
  return { deleted };
}

function blogUrls(slug: string): string[] {
  return [
    ...routing.locales.flatMap((locale) => [
      getPathname({ locale, href: "/blog" }),
      getPathname({
        locale,
        href: { pathname: "/blog/[slug]", params: { slug } },
      }),
      `/${locale}/blog/feed.xml`,
    ]),
    "/sitemap.xml",
    "/llms.txt",
  ].map((path) => new URL(path, env.siteOrigin).href);
}

// Only for a write that changed what the public sees (the old or the new
// version is visible): drafts and still-scheduled posts never reached the edge.
// NOT purged, so they wait for the edge TTL: other posts' pages (their
// prev/next and related cards) and a scheduled post going live on its date.
// Never throws: the write already landed, a stale edge copy only delays it.
async function purgeBlogPages(slug: string): Promise<void> {
  if (!serverEnv.cloudflarePurgeToken || !serverEnv.cloudflareZoneId) return;
  const urls = blogUrls(slug);
  const batches: string[][] = [];
  for (let i = 0; i < urls.length; i += PURGE_BATCH)
    batches.push(urls.slice(i, i + PURGE_BATCH));
  await Promise.all(
    batches.map(async (files) => {
      const res = await safeFetchRaw(
        `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(serverEnv.cloudflareZoneId)}/purge_cache`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${serverEnv.cloudflarePurgeToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ files }),
          maxBytes: 64 * 1024,
        },
      ).catch((err: unknown) => ({ status: 0, error: errMessage(err) }));
      if (res.status !== 200)
        logger.warn("Blog edge purge failed", {
          context: "blog",
          slug,
          status: res.status,
          ...("error" in res && { err: res.error }),
        });
    }),
  );
}
