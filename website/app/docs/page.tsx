import type { Metadata } from "next";
import { DocView } from "../../components/DocView";
import { DEFAULT_SLUG, getDoc } from "../../lib/docs";

export function generateMetadata(): Metadata {
  const doc = getDoc(DEFAULT_SLUG);
  return { title: doc?.title, description: doc?.description };
}

export default function DocsIndexPage() {
  return <DocView slug={DEFAULT_SLUG} />;
}
