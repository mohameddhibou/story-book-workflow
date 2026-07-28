import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ADK's barrel reaches express, mikro-orm and sqlite3; leave it to Node.
  // The MCP SDK spawns servers as child processes, so it stays unbundled too.
  // The MCP server packages themselves are deliberately absent: we never import
  // them, only resolve their paths at runtime and hand those to Node.
  serverExternalPackages: ["@google/adk", "@modelcontextprotocol/sdk"],
  /* config options here */
};

export default nextConfig;
