import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16.3+ appends a generic "agent rules" block to CLAUDE.md whenever
  // `next dev` detects an AI coding agent. CLAUDE.md is kept lean (it's resent
  // every turn), so it's off; the version-matched docs it points to are still
  // in node_modules/next/dist/docs/.
  agentRules: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
      {
        protocol: "https",
        hostname: "cdn.erply.com",
      },
    ],
  },
};

export default nextConfig;
