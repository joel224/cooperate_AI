import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth'; // Assuming authOptions are in lib/auth.ts

// This is the root page that handles initial authentication redirection.
// It checks for an active session and redirects users accordingly.
export default async function HomePage() {
  const session = await getServerSession(authOptions);

  if (session) { // If a session exists, redirect to the dashboard.
    // Redirect authenticated users to their dashboard
    redirect('/dashboard');
  } else {
    // Redirect unauthenticated users to the sign-in page
    redirect('/login');
  }

  // This part will likely not be rendered due to redirects
  return (
    <div className="flex justify-center items-center h-screen">
      <p>Redirecting...</p>
    </div>
  );
}
