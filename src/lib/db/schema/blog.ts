// Server-only: posts published through /api/blog/posts. Registry posts stay in
// code; these are read per request and rendered next to them.
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { uid } from "@/lib/utils/base";
import type { BlogCategory } from "@/lib/types";
import type { BlogPostTranslations } from "@/lib/api/typebox/blog";
import type { BlogPostStatus, BlogTag } from "@/lib/validation/blog";
import type { Locale } from "next-intl";
import { timestamps } from "./shared";

export const blogPosts = sqliteTable(
  "blog_posts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uid()),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    body: text("body").notNull(),
    tags: text("tags", { mode: "json" }).$type<BlogTag[]>().notNull(),
    category: text("category").$type<BlogCategory>().notNull(),
    // YYYY-MM-DD, same as the registry; a future date schedules the post.
    date: text("date").notNull(),
    author: text("author").notNull(),
    status: text("status").$type<BlogPostStatus>().notNull(),
    heroImage: text("hero_image"),
    translations: text("translations", {
      mode: "json",
    }).$type<BlogPostTranslations>(),
    // Per locale, counted at write time so list readers never load a body. The
    // keys are the locales the post exists in: the base text plus translations.
    wordCounts: text("word_counts", { mode: "json" })
      .$type<Partial<Record<Locale, number>>>()
      .notNull(),
    ...timestamps(),
  },
  (table) => [index("idx_blog_posts_status_date").on(table.status, table.date)],
);
