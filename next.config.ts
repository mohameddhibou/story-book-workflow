import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ADK's barrel reaches express, mikro-orm and sqlite3; leave it to Node.
  serverExternalPackages: ["@google/adk"],
  /* config options here */
};

export default nextConfig;
