import { getDbPosts } from "@/components/pages/blog/db-posts";
import { COMPARE_PAIRS } from "@/components/pages/navbar/models/compare/compare-pairs";
import { getPathname } from "@/i18n/navigation";
import {
  BLOG_REGISTRY,
  DEFAULT_PRIORITY,
  DOCS_REGISTRY,
  SECTION_PRIORITIES,
  type SeoTimestampSlug,
} from "@/i18n/registry";
import {
  type Pathname,
  type StaticRoute,
  pathnames,
  privateRoutes,
  routing,
} from "@/i18n/routing";
import { env } from "@/lib/config/env";
import { getSeoTimestamps } from "@/lib/seo/metadata";
import { modelSlug, vendorSlug } from "@/lib/utils/base";
import { dayjs } from "@/lib/utils/format/date";
import { getCatalog } from "@/server/models/pricing/pricing.service";
import type { MetadataRoute } from "next";
import type { Locale } from "next-intl";

type EntryOptions = {
  priority?: number;
  changeFrequency?: MetadataRoute.Sitemap[number]["changeFrequency"];
  lastModified?: Date | SeoTimestampSlug;
  // Locales the page has its own text in; the rest canonicalise elsewhere.
  locales?: readonly Locale[];
};

const privateSet = new Set<string>([
  ...privateRoutes.static,
  ...privateRoutes.dynamicParents,
]);

// next.config.ts redirects this permanently, so it is not a canonical URL.
const REDIRECTED_ROUTES = new Set<string>(["/docs"]);

const docUrlSet = new Set<string>(
  DOCS_REGISTRY.map((doc) =>
    getPathname({ locale: routing.defaultLocale, href: doc.path }),
  ),
);

function localizedEntries(
  href: Pathname,
  options: EntryOptions,
): MetadataRoute.Sitemap {
  const lastModified =
    typeof options.lastModified === "string"
      ? (getSeoTimestamps(options.lastModified)?.modified ?? null)
      : options.lastModified;
  const resolved = dayjs(
    lastModified ?? process.env.NEXT_PUBLIC_BUILD_DATE,
  ).toDate();

  // No per-URL hreflang alternates: 18 locales pushed this past Google's 50MB
  // limit (53MB, ~416k xhtml:link entries) and it stopped being read.
  return (options.locales ?? routing.locales).map((locale) => ({
    url: `${env.siteOrigin}${getPathname({ locale, href })}`,
    lastModified: resolved,
    ...(options.priority !== undefined && { priority: options.priority }),
    ...(options.changeFrequency && {
      changeFrequency: options.changeFrequency,
    }),
  }));
}

function sectionOptions(route: StaticRoute): EntryOptions {
  return route in SECTION_PRIORITIES
    ? SECTION_PRIORITIES[route as keyof typeof SECTION_PRIORITIES]
    : DEFAULT_PRIORITY;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes = (
    Object.keys(pathnames) as (keyof typeof pathnames)[]
  ).filter((route): route is StaticRoute => !route.includes("["));
  const topLevelRoutes = staticRoutes.filter(
    (route) =>
      !privateSet.has(route) &&
      !REDIRECTED_ROUTES.has(route) &&
      !docUrlSet.has(
        getPathname({ locale: routing.defaultLocale, href: route }),
      ),
  );

  const pricing = await getCatalog(false, true).catch(() => null);
  if (!pricing?.models?.length)
    console.error(
      "[sitemap] pricing returned no models; model pages omitted from sitemap",
    );

  // Listed once per locale the post has text in; the visibility rule is the
  // service's, the same one the pages apply. A metadata route cannot set its
  // own Cache-Control, so a failed read is only logged; the purge on the next
  // write or the edge TTL brings the posts back.
  const { posts: storedPosts } = await getDbPosts(routing.defaultLocale);

  const modelNames = [
    ...new Set((pricing?.models ?? []).map((m) => m.model_name)),
  ];
  const nameSet = new Set(modelNames);

  const nameToVendor = new Map<string, string>(
    (pricing?.models ?? []).map((m) => [m.model_name, m.vendor] as const),
  );
  const nameToReleaseDate = new Map<string, Date>();
  for (const model of pricing?.models ?? []) {
    const ms = model.release_ts;
    if (ms) nameToReleaseDate.set(model.model_name, new Date(ms));
  }
  const sitemapModelNames = modelNames.filter((name) =>
    vendorSlug(nameToVendor.get(name) ?? ""),
  );
  const sitemapVendorSlugs = [
    ...new Set(
      (pricing?.models ?? [])
        .map((m) => vendorSlug(m.vendor))
        .filter(Boolean),
    ),
  ];

  return [
    ...topLevelRoutes.flatMap((route) =>
      localizedEntries(route, sectionOptions(route)),
    ),
    ...DOCS_REGISTRY.flatMap((doc) =>
      localizedEntries(doc.path, {
        priority: doc.priority,
        changeFrequency: doc.changeFrequency,
        lastModified: doc.slug,
      }),
    ),
    ...BLOG_REGISTRY.flatMap((post) =>
      localizedEntries(
        { pathname: "/blog/[slug]", params: { slug: post.slug } },
        {
          priority: post.priority,
          changeFrequency: post.changeFrequency,
          lastModified: `blog/${post.slug}`,
        },
      ),
    ),
    ...storedPosts.flatMap((post) =>
      localizedEntries(
        { pathname: "/blog/[slug]", params: { slug: post.slug } },
        {
          priority: 0.7,
          changeFrequency: "monthly",
          lastModified: post.modified,
          locales: post.locales,
        },
      ),
    ),
    ...sitemapModelNames.flatMap((name) => {
      const slug = [vendorSlug(nameToVendor.get(name) ?? ""), modelSlug(name)];
      return localizedEntries(
        { pathname: "/models/[...slug]", params: { slug } },
        {
          priority: 0.6,
          changeFrequency: "weekly",
          // No build-date fallback: "changed today" every deploy stalled recrawl
          // of ~5.6k model URLs.
          lastModified: nameToReleaseDate.get(name),
        },
      );
    }),
    ...sitemapVendorSlugs.flatMap((slug) =>
      localizedEntries(
        { pathname: "/models/[...slug]", params: { slug: [slug] } },
        { priority: 0.5, changeFrequency: "weekly" },
      ),
    ),
    ...COMPARE_PAIRS.filter(([a, b]) =>
      [a, b].every((name) => nameSet.has(name)),
    ).flatMap(([a, b]) =>
      localizedEntries(
        {
          pathname: "/compare/[...slugs]",
          params: { slugs: [modelSlug(a), modelSlug(b)] },
        },
        { priority: 0.5, changeFrequency: "weekly" },
      ),
    ),
  ];
}
