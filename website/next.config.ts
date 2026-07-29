import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fully static export: every route is pre-rendered to plain HTML at build
  // time and served from any static host — no Node server needed.
  output: "export",
  trailingSlash: true,
};

export default nextConfig;
