import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocView } from "../../../components/DocView";
import { ORDERED_SLUGS, getDoc } from "../../../lib/docs";

export function generateStaticParams() {
  return ORDERED_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDoc(slug);
  return { title: doc?.title, description: doc?.description };
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!getDoc(slug)) notFound();
  return <DocView slug={slug} />;
}
