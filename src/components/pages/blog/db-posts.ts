import { routing } from "@/i18n/routing";
import { BLOG_CATEGORIES } from "@/lib/config/blog-categories";
import type { BlogListPost } from "@/lib/types";
import { errMessage } from "@/lib/utils/base";
import { dayjs } from "@/lib/utils/format/date";
import { logger } from "@/lib/utils/logger";
import { BLOG_TAGS } from "@/lib/validation/blog";
import {
  getVisiblePost,
  listVisiblePosts,
} from "@/server/blog/posts/posts.service";
import type { Locale } from "next-intl";
import { cache } from "react";

// A stalled Turso must not hold a blog page open.
const DB_TIMEOUT_MS = 2500;

const KNOWN_CATEGORIES: ReadonlySet<string> = new Set(BLOG_CATEGORIES);
const KNOWN_TAGS: ReadonlySet<string> = new Set(BLOG_TAGS);

export type DbBlogPost = BlogListPost & {
  author: string;
  modified: Date;
  // The base text's locale plus the translated ones; any other locale renders
  // the base text under the default locale's canonical URL.
  locales: Locale[];
  // The locale the text actually is in: the requested one when translated,
  // else the base (default locale) text.
  contentLocale: Locale;
};

// A list read that failed fell back to registry-only: callers must not let
// that answer be cached publicly for the normal TTL.
export type DbPostsResult = { posts: DbBlogPost[]; complete: boolean };

type CardRow = Awaited<ReturnType<typeof listVisiblePosts>>[number];

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error(`Blog posts query timed out (${DB_TIMEOUT_MS}ms)`)),
      DB_TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// For every stored-post date (JSON-LD, feed, sitemap): the last edit, but never
// before the post's own date, which a scheduled post edited early would claim.
export function storedModified(post: { date: string; updatedAt: Date }): Date {
  const published = dayjs.utc(post.date);
  const updated = dayjs(post.updatedAt);
  return (updated.isAfter(published) ? updated : published).toDate();
}

// A category or tag this build has no theme or translation for would throw at
// render; such a row (written by another deploy, or by hand) is skipped.
function toPost(row: CardRow, locale: Locale): DbBlogPost | null {
  if (
    !KNOWN_CATEGORIES.has(row.category) ||
    row.tags.some((tag) => !KNOWN_TAGS.has(tag))
  ) {
    logger.warn("Skipping a stored blog post with an unknown category or tag", {
      context: "blog",
      slug: row.slug,
      category: row.category,
      tags: row.tags,
    });
    return null;
  }
  return {
    slug: row.slug,
    date: row.date,
    tags: row.tags,
    category: row.category,
    heroImage: row.heroImage ?? undefined,
    title: row.title,
    description: row.description,
    author: row.author,
    wordCount:
      row.wordCounts[locale] ?? row.wordCounts[routing.defaultLocale] ?? 0,
    modified: storedModified(row),
    locales: routing.locales.filter((l) => row.wordCounts[l] !== undefined),
    contentLocale:
      row.wordCounts[locale] !== undefined ? locale : routing.defaultLocale,
  };
}

// Slugs seen by the last successful reads. When the database fails, a URL in
// this set is a real post and gets a 5xx (retried, never edge-cached); any
// other slug 404s as usual, so an outage cannot turn every unknown
// /blog/<slug> into a 5xx. After a restart the set is empty until a read
// succeeds, so a post requested only during an outage 404s: the accepted cost.
const knownStoredSlugs = new Set<string>();

// Per-request dedup only: an edit shows on the next render with no TTL to wait
// out. A dead, slow or unconfigured database leaves the registry posts standing.
export const getDbPosts = cache(
  async (locale: Locale): Promise<DbPostsResult> =>
    withTimeout(listVisiblePosts(locale))
      .then((rows) => {
        knownStoredSlugs.clear();
        for (const row of rows) knownStoredSlugs.add(row.slug);
        const posts = rows.flatMap((row) => toPost(row, locale) ?? []);
        return { posts, complete: true };
      })
      .catch((err: unknown) => {
        logger.warn("Blog posts unavailable, rendering the registry only", {
          context: "blog",
          err: errMessage(err),
        });
        return { posts: [], complete: false };
      }),
);

export const getDbPost = cache(
  async (
    slug: string,
    locale: Locale,
  ): Promise<(DbBlogPost & { body: string }) | null> => {
    const row = await withTimeout(getVisiblePost(slug, locale)).catch(
      (err: unknown) => {
        const known = knownStoredSlugs.has(slug);
        logger.error("Stored blog post unavailable", {
          context: "blog",
          slug,
          known,
          err: errMessage(err),
        });
        if (known) throw err;
        return null;
      },
    );
    if (row) knownStoredSlugs.add(row.slug);
    const post = row && toPost(row, locale);
    return post && row ? { ...post, body: row.body } : null;
  },
);
