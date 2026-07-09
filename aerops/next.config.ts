import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // Versioned public API surface. External clients (and future mobile
      // apps) call /api/v1/*; handlers live unversioned under /api/* until a
      // breaking change forks a v2 implementation.
      { source: "/api/v1/:path*", destination: "/api/:path*" },
    ];
  },
};

export default nextConfig;
