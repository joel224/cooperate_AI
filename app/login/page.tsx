// page.tsx
/*
  This is the custom sign-in page for the application.
  It provides options for both temporary credentials-based login (for development)
  and external Google authentication (for future cloud integration).
*/
'use client';

import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function SignInPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Redirect authenticated users to the dashboard.
  useEffect(() => {
    if (status === 'authenticated') {
      router.push('/dashboard');
    }
  }, [status, router]);

  // Handle Google sign-in.
  const handleGoogleSignIn = () => {
    signIn('google', { callbackUrl: '/dashboard' });
  };

  // Handle Credentials sign-in.
  const handleCredentialsSignIn = async () => {
    setError(null); // Clear previous errors
    const result = await signIn('credentials', {
      redirect: false, // Prevent NextAuth from redirecting automatically
      username,
      password,
      callbackUrl: '/dashboard',
    });

    if (result?.error) {
      setError(result.error); // Display error message from NextAuth
    } else if (result?.ok) {
      router.push('/dashboard'); // Manual redirect on success
    }
  };

  // Show loading state while session is being checked.
  if (status === 'loading' || status === 'authenticated') {
    return (
      <div className="flex justify-center items-center h-screen">
        <p>Loading...</p>
      </div>
    );
  }

  // Render sign-in form for unauthenticated users.
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="p-8 max-w-sm w-full bg-white rounded-lg shadow-md">
        <h1 className="text-2xl font-bold text-center text-gray-800 mb-6">Sign In</h1>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
            <strong className="font-bold">Error:</strong>
            <span className="block sm:inline"> {error}</span>
          </div>
        )}

        {/* Temporary Credentials Login Form for Development */}
        <div className="mb-4">
          <input type="text" placeholder="Username (e.g., developer)" className="w-full px-4 py-2 mb-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input type="password" placeholder="Password (e.g., password)" className="w-full px-4 py-2 mb-4 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button onClick={handleCredentialsSignIn} className="w-full px-4 py-2 text-white bg-green-600 rounded-md hover:bg-green-700 focus:outline-none">Sign in with Credentials</button>
        </div>

        <div className="text-center my-4">
          <span className="text-gray-500">OR</span>
        </div>

        {/* Google Sign-in Button */}
        {/* This button is for external Google authentication, which can be part of a future cloud integration. */}
        <button onClick={handleGoogleSignIn} className="w-full px-4 py-2 text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none">Sign in with Google</button>

        <p className="text-xs text-center text-gray-500 mt-4">
          More providers can be added here.
        </p>
      </div>
    </div>
  );
}
