import type { NextConfig } from "next";

// When set at build time, the app proxies the API through its own origin
// (build with NEXT_PUBLIC_API_URL="" so the browser calls /api/... directly).
// Used for single-port deployments where only the frontend port is public.
const backend = process.env.FALMEX_BACKEND_URL;

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: __dirname,
  devIndicators: false,
  async rewrites() {
    if (!backend) return [];
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/health", destination: `${backend}/health` },
    ];
  },
};

export default nextConfig;
