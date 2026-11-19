import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@encuanto/contracts'],
  // ESLint se ejecuta desde la raíz del monorepo (pnpm lint), no durante el build.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    // Cabeceras básicas. La CSP completa llega en H7 (§12).
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
