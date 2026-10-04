import { env } from "@/lib/config/env";
import {
  buildArticleSchema,
  buildBreadcrumbListSchema,
  type BreadcrumbItem,
} from "@/lib/seo/structured-data";
import type { DocSlug } from "@/lib/types";
import { getLocale, getTranslations } from "next-intl/server";
import type { Thing, WithContext } from "schema-dts";
import { getSeoTimestamps } from "./metadata";

interface JsonLdProps {
  data: WithContext<Thing> | WithContext<Thing>[];
  id?: string;
}

// JSON.stringify leaves "</script>" intact, and stored blog posts put API input
// into this tag: escaped, a title can never close the script and inject markup.
const SCRIPT_UNSAFE: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

export function JsonLd(props: JsonLdProps) {
  const json = JSON.stringify(props.data).replace(
    /[<>&\u2028\u2029]/g,
    (ch) => SCRIPT_UNSAFE[ch]!,
  );
  return (
    <script
      key={props.id}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
      suppressHydrationWarning
    />
  );
}

interface DocPageSchemaProps {
  slug: DocSlug;
  title: string;
  description: string;
  image?: string;
}

export async function DocPageSchema(props: DocPageSchemaProps) {
  const locale = await getLocale();
  const t = await getTranslations();
  const ts = getSeoTimestamps(props.slug);

  const breadcrumb: BreadcrumbItem[] = [
    { name: t("NAV.HOME"), url: `/${locale}` },
    { name: t("NAV.DOCS"), url: `/${locale}/docs` },
    { name: props.title, url: `/${locale}/${props.slug}` },
  ];

  return (
    <>
      <JsonLd
        id={`${props.slug}-breadcrumb`}
        data={buildBreadcrumbListSchema(breadcrumb)}
      />
      <JsonLd
        id={`${props.slug}-article`}
        data={buildArticleSchema({
          locale,
          headline: props.title,
          description: props.description,
          url: `/${locale}/${props.slug}`,
          image: props.image,
          datePublished: ts?.published,
          dateModified: ts?.modified,
          author: {
            type: "Organization",
            name: env.appName,
          },
        })}
      />
    </>
  );
}
