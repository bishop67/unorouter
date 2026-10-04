import { Markdown } from "fumadocs-core/content/md";
import { createHash } from "node:crypto";
import type { ReactNode } from "react";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

// remark-rehype already prefixes footnote ids AND their links with
// "user-content-"; sanitize's own prefix would land on the ids only and break
// every footnote link. Raw HTML is dropped before this, so no id comes from
// the author's markup.
const SANITIZE_SCHEMA = { ...defaultSchema, clobberPrefix: "" };

// Parsing and sanitizing a long body is the slow part of the page, and the
// input only changes with an edit: render once per content. Keyed by the
// body's hash and the locale the text is in (never anything request- or
// user-specific), so a recreated post can never get an old render. Bounded by
// entries and by total body length.
const RENDERED_MAX = 64;
const RENDERED_MAX_CHARS = 8_000_000;
const rendered = new Map<string, { node: Promise<ReactNode>; size: number }>();
let renderedChars = 0;

function evict(key: string) {
  const entry = rendered.get(key);
  if (!entry) return;
  rendered.delete(key);
  renderedChars -= entry.size;
}

function render(key: string, body: string): Promise<ReactNode> {
  const hit = rendered.get(key);
  if (hit) {
    rendered.delete(key);
    rendered.set(key, hit);
    return hit.node;
  }
  const node = Promise.resolve(
    Markdown({
      remarkPlugins: [remarkGfm],
      rehypePlugins: [[rehypeSanitize, SANITIZE_SCHEMA]],
      children: body,
    }),
  );
  node.catch(() => evict(key));
  rendered.set(key, { node, size: body.length });
  renderedChars += body.length;
  for (const oldest of rendered.keys()) {
    if (rendered.size <= RENDERED_MAX && renderedChars <= RENDERED_MAX_CHARS)
      break;
    evict(oldest);
  }
  return node;
}

// Stored bodies arrive over the API, not through review. remark-rehype drops raw
// HTML and rehype-sanitize keeps GitHub's safe subset: no script, no on*
// handlers, no javascript: links.
export async function PostMarkdown(props: {
  slug: string;
  locale: string;
  body: string;
}) {
  const hash = createHash("sha256").update(props.body).digest("base64url");
  return render(`${props.slug}:${props.locale}:${hash}`, props.body);
}
