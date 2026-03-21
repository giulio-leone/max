/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/max/:path*",
        destination: "http://localhost:7777/:path*",
      },
    ];
  },
};

export default nextConfig;
