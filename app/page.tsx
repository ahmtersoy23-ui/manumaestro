/**
 * Root Page
 * Redirects to dashboard
 */

import { redirect } from 'next/navigation';

export default function Home() {
  // For now, redirect directly to dashboard
  // Later, this will check authentication and redirect to login if needed
  redirect('/dashboard');
}
