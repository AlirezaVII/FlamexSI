import type { NextConfig } from "next";

// When set at build time, the app proxies the API through its own origin
// (build with NEXT_PUBLIC_API_URL="" so the browser calls /api/... directly).
// Used for single-port deployments where only the frontend port is public.
const backend = process.env.FALMEX_BACKEND_URL;

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: __dirname,
  images: { qualities: [75, 90] },
  // uploads go through the /api proxy; the default 10 MB buffer cut NASA files short.
  // 100 MB stays safe on the 1 GB droplet (the body is buffered in memory)
  experimental: { proxyClientMaxBodySize: "100mb" },
  devIndicators: false,
  // planet maps rarely change: let browsers keep them for a week (revalidate in background)
  async headers() {
    return [
      {
        source: "/textures/:file*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, stale-while-revalidate=2592000",
          },
        ],
      },
    ];
  },
  // the flight evidence page used to be a standalone HTML file
  async redirects() {
    return [
      { source: "/flex-comparison.html", destination: "/flight-evidence", permanent: true },
    ];
  },
  async rewrites() {
    if (!backend) return [];
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/health", destination: `${backend}/health` },
    ];
  },
};

export default nextConfig;
