import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Force new build ID to bust Cloudflare cache
  generateBuildId: async () => {
    return `build-${Date.now()}`;
  },
};

export default nextConfig;
