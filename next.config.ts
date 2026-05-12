import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
  // Force new build ID to bust Cloudflare cache
  generateBuildId: async () => {
    return `build-${Date.now()}`;
  },
  // Tree-shake lucide-react: 560+ icon'dan sadece import edilenler bundle'a girer.
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Content-Security-Policy',
            // unsafe-eval sadece dev mode'da (Next/Turbopack HMR eval kullaniyor).
            // Production'da kaldirildi — XSS yuzeyini azaltir.
            // unsafe-inline Next.js production'da hala gerekli (RSC payload + style chunks);
            // nonce-based CSP'ye geciste ayri ele alinacak.
            value: [
              "default-src 'self'",
              `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV !== 'production' ? " 'unsafe-eval'" : ''}`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "media-src 'self' blob:", // kamera barkod scan için (zxing)
              "font-src 'self'",
              "connect-src 'self' https://apps.iwa.web.tr",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
          {
            // camera=(self) — WMS scan-to-confirm için zorunlu
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=()',
          },
        ],
      },
      {
        // SW kendisi browser cache'lenmesin — yeni deploy'da hemen aktif olsun
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
};

// Sentry — DSN ve org/project env'leri eksikse withSentryConfig hata vermez; yalnızca
// source-map upload + tunnel route'u skip eder. Bu yüzden DSN olmadığında build sorunsuz.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  tunnelRoute: '/monitoring',
  sourcemaps: { disable: false, deleteSourcemapsAfterUpload: true },
  webpack: {
    treeshake: { removeDebugLogging: true },
    reactComponentAnnotation: { enabled: false },
  },
});
