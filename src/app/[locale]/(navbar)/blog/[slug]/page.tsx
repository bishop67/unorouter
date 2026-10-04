import { BlogPost } from "@/components/pages/blog/blog-post";
import { faqI18nKey, resolveBlogPost } from "@/components/pages/blog/posts";
import { localeUrl } from "@/i18n/navigation";
import type { Pathname } from "@/i18n/routing";
import { APP_VALUES } from "@/lib/config/constants";
import { JsonLd } from "@/lib/seo/json-ld";
import { getPageMetadata, notFoundMetadata, ogBadge } from "@/lib/seo/metadata";
import {
  buildArticleSchema,
  buildBreadcrumbListSchema,
  buildFAQPageSchema,
} from "@/lib/seo/structured-data";
import { dayjs } from "@/lib/utils/format/date";
import { serverLocale } from "@/lib/utils/server";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
}

async function resolvePost(props: PageProps) {
  const params = await props.params;
  const locale = await serverLocale(props);
  const t = await getTranslations({ locale });
  const resolved = await resolveBlogPost(t, locale, params.slug);
  return resolved && { ...resolved, locale, t };
}

export async function generateMetadata(props: PageProps) {
  const resolved = await resolvePost(props);
  if (!resolved) return notFoundMetadata();
  const { locale, t, post } = resolved;

  return getPageMetadata({
    locale,
    href: { pathname: "/blog/[slug]", params: { slug: post.slug } },
    locales: resolved.locales,
    title: t("BLOG.POST_META_TITLE", { ...APP_VALUES, title: post.title }),
    description: post.description,
    keywords: post.tags.join(", "),
    ogImage: ogBadge("banner", locale),
  });
}

export default async function BlogPostPage(props: PageProps) {
  const resolved = await resolvePost(props);
  if (!resolved) notFound();
  const { locale, t, post } = resolved;
  const faqKey = resolved.registry && faqI18nKey(resolved.registry);
  const href: Pathname = {
    pathname: "/blog/[slug]",
    params: { slug: post.slug },
  };
  const url = localeUrl(locale, href);
  // The article is the text shown: an untranslated stored post is the base
  // text at its canonical URL, matching the page's canonical link.
  const articleUrl = localeUrl(resolved.contentLocale, href);

  return (
    <>
      <JsonLd
        id={`blog-${post.slug}-breadcrumb`}
        data={buildBreadcrumbListSchema([
          { name: t("NAV.HOME"), url: localeUrl(locale, "/") },
          { name: t("BLOG.TITLE"), url: localeUrl(locale, "/blog") },
          { name: post.title, url },
        ])}
      />
      <JsonLd
        id={`blog-${post.slug}-article`}
        data={buildArticleSchema({
          locale: resolved.contentLocale,
          headline: post.title,
          description: post.description,
          url: articleUrl,
          datePublished: resolved.published,
          dateModified: dayjs.utc(post.modified).format("YYYY-MM-DD"),
          author: post.author,
        })}
      />
      {faqKey && (
        <JsonLd
          id={`blog-${post.slug}-faq`}
          data={buildFAQPageSchema(
            ([1, 2, 3] as const).map((n) => ({
              question: t(`${faqKey}.FAQ_${n}_Q`, APP_VALUES),
              answer: t(`${faqKey}.FAQ_${n}_A`, APP_VALUES),
            })),
          )}
        />
      )}
      <BlogPost resolved={resolved} />
    </>
  );
}
