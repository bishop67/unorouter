import { Type as t, type Static } from "@sinclair/typebox/type";
import type { TranslationKey } from "@/lib/types";
import { BLOG_CATEGORIES } from "../config/blog-categories";

export const BLOG_POST_STATUSES = ["draft", "published"] as const;
export const blogPostStatus = t.Union(
  BLOG_POST_STATUSES.map((s) => t.Literal(s)),
);
export type BlogPostStatus = Static<typeof blogPostStatus>;

export const blogCategory = t.Union(BLOG_CATEGORIES.map((c) => t.Literal(c)));

// Tags render through BLOG.TAG.<tag>, and a missing key throws in dev, so only
// tags that already have a translation are accepted; `satisfies` fails the
// type check for a tag without one.
type TranslatedTag<K = TranslationKey> = K extends `BLOG.TAG.${infer Tag}`
  ? Tag
  : never;
export const BLOG_TAGS = [
  "announcement",
  "product",
  "engineering",
  "update",
  "community",
  "comparison",
] as const satisfies readonly TranslatedTag[];
export const blogTag = t.Union(BLOG_TAGS.map((tag) => t.Literal(tag)));
export type BlogTag = Static<typeof blogTag>;
