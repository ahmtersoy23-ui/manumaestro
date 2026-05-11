/**
 * /auth/* segment layout — root layout'taki AuthProvider'ı bypass eder.
 * Bootstrap page cookie henüz set edilmemişken yüklendiği için AuthContext'in
 * /api/auth/me çağrısının fail olmaması gerekir.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
