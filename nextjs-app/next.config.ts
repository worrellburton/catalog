import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/catalogwebapp',
  assetPrefix: '/catalogwebapp/',
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
};

export default nextConfig;
