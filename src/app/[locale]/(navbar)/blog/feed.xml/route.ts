import { getBlogListPosts } from "@/components/pages/blog/posts";
import { APP_VALUES } from "@/lib/config/constants";
import { env } from "@/lib/config/env";
import { dayjs } from "@/lib/utils/format/date";
import { serverLocale } from "@/lib/utils/server";
import { Feed } from "feed";
import { getTranslations } from "next-intl/server";

// feed wraps titles and descriptions in CDATA, and its xml-js escapes only the
// FIRST "]]>": a stored title with two would end the section and inject markup.
function cdataSafe(text: string): string {
  return text.replaceAll("]]>", "]]&gt;");
}

export async function GET(
  _req: Request,
  props: { params: Promise<{ locale: string }> },
) {
  const locale = await serverLocale(props);
  const t = await getTranslations({ locale });
  const { posts, complete } = await getBlogListPosts(t, locale);
  const siteUrl = `${env.siteOrigin}/${locale}/blog`;

  const feed = new Feed({
    title: t("BLOG.RSS_TITLE", APP_VALUES),
    description: t("BLOG.RSS_DESC", APP_VALUES),
    id: siteUrl,
    link: siteUrl,
    language: locale,
    feedLinks: { rss2: `${env.siteOrigin}/${locale}/blog/feed.xml` },
    copyright: `© ${dayjs().year()} ${env.appName}`,
  });

  for (const post of posts) {
    const url = `${env.siteOrigin}/${locale}/blog/${post.slug}`;
    feed.addItem({
      title: cdataSafe(post.title),
      id: url,
      link: url,
      description: cdataSafe(post.description),
      author: [{ name: post.author }],
      date: post.modified,
      category: post.tags.map((tag) => ({ name: tag })),
    });
  }

  return new Response(feed.rss2(), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      // A registry-only fallback must not sit at the edge for an hour.
      "Cache-Control": complete
        ? "public, s-maxage=3600, stale-while-revalidate=60"
        : "no-store",
    },
  });
}
