import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: process.env.BASE44_PUBLIC_HOST_SUFFIX
    ? [`3000-${process.env.BASE44_PUBLIC_HOST_SUFFIX}`]
    : [],
};

export default nextConfig;
