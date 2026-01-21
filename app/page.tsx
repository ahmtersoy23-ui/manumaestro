/**
 * Root Page
 * Redirects to dashboard
 * SSO authentication is handled by middleware.ts
 */

import { redirect } from 'next/navigation';

export default function Home() {
  // User is authenticated if they reach here (middleware validates)
  redirect('/dashboard');
}
