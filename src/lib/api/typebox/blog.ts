import { t, type Static } from "elysia";
import { LOCALES } from "@/lib/config/constants";
import type { BlogPostRow } from "@/lib/db/schema/rows";
import type { Locale } from "next-intl";
import { blogCategory, blogPostStatus, blogTag } from "@/lib/validation/blog";

const MAX_BODY_LEN = 200_000;

const blogPostText = {
  title: t.String({ minLength: 1, maxLength: 200 }),
  description: t.String({ minLength: 1, maxLength: 500 }),
  body: t.String({ minLength: 1, maxLength: MAX_BODY_LEN }),
};

const blogPostTextSchema = t.Object(blogPostText);

const blogPostTranslations = t.Partial(
  t.Record(t.Union(LOCALES.map((l) => t.Literal(l))), blogPostTextSchema),
  { additionalProperties: false },
);
// Elysia normalizes the body before Check, so an unknown locale key is dropped
// silently rather than refused here; the route rejects it before validation.
// Spelled out: a Record keyed by a mapped union resolves to {} under Static.
export type BlogPostTranslations = Partial<
  Record<Locale, Static<typeof blogPostTextSchema>>
>;

export const blogSlugParams = t.Object({
  slug: t.String({
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    minLength: 1,
    maxLength: 128,
  }),
});

// ?drafts=1 asks for drafts and scheduled posts; only a verified publisher
// gets them, anyone else the public view.
export const blogDraftsQuery = t.Object({
  drafts: t.Optional(t.Literal("1")),
});

export const blogPostBody = t.Object({
  ...blogPostText,
  tags: t.Array(blogTag, { maxItems: 6, uniqueItems: true, default: [] }),
  category: blogCategory,
  // YYYY-MM-DD only; the route also refuses a date the calendar lacks
  // (2026-02-31), which the pattern cannot see.
  date: t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  author: t.String({ minLength: 1, maxLength: 100 }),
  status: blogPostStatus,
  // Absolute https URL or a path under /images; anything else would reach
  // next/image unvetted.
  heroImage: t.Optional(
    t.Nullable(
      t.String({ pattern: "^(https://|/images/)[^\\s]+$", maxLength: 2048 }),
    ),
  ),
  translations: t.Optional(t.Nullable(blogPostTranslations)),
});
export type BlogPostBody = Static<typeof blogPostBody>;

// Timestamps as epoch ms; word counts are a storage detail.
export type BlogPostDto = Omit<
  BlogPostRow,
  "createdAt" | "updatedAt" | "wordCounts"
> & {
  createdAt: number;
  updatedAt: number;
};

// List rows: no body, no translated texts; GET /:slug carries those.
export type BlogPostSummaryDto = Omit<BlogPostDto, "body" | "translations"> & {
  locales: Locale[];
};
