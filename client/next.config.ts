import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**", // narrow this to your actual R2 public domain before shipping
      },
    ],
  },
};

export default nextConfig;
