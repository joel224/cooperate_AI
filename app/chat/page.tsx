// f:/New folder/corporate-compass-ai/app/chat/page.tsx
'use client';

import { useState, FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

interface Source {
  pageContent: string;
  metadata: {
    source: string;
    chunk_index: number;
    // Add other metadata fields you might store
  };
}

export default function ChatPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [query, setQuery] = useState<string>('');
  const [response, setResponse] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect if not authenticated (you might want to allow all users or specific roles)
  if (status === 'loading') {
    return <div className="flex justify-center items-center h-screen"><p>Loading...</p></div>;
  }

  if (status === 'unauthenticated') {
    router.push('/login'); // Redirect to login if not authenticated
    return null; // Don't render anything while redirecting
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) {
      setError('Please enter a query.');
      return;
    }

    setLoading(true);
    setResponse(null);
    setSources([]);
    setError(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      const data = await res.json();

      if (res.ok) {
        setResponse(data.response);
        setSources(data.sources || []);
      } else {
        setError(data.message || 'Failed to get response from AI.');
      }
    } catch (err) {
      console.error('Chat API call error:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      <div className="p-8 max-w-2xl w-full bg-white rounded-lg shadow-md">
        <h1 className="text-2xl font-bold text-center text-gray-800 mb-6">Corporate Compass AI Chat</h1>

        <form onSubmit={handleSubmit} className="space-y-4 mb-6">
          <div>
            <label htmlFor="query" className="sr-only">Your Query</label>
            <input
              id="query"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask a question about your internal documents..."
              className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
          </div>
          <button
            type="submit"
            className="w-full px-4 py-2 text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={loading}
          >
            {loading ? 'Thinking...' : 'Ask AI'}
          </button>
        </form>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
            <strong className="font-bold">Error:</strong>
            <span className="block sm:inline"> {error}</span>
          </div>
        )}

        {response && (
          <div className="bg-gray-50 p-4 rounded-md border border-gray-200 mb-4">
            <h2 className="font-semibold text-lg mb-2">AI Response:</h2>
            <p className="text-gray-700">{response}</p>
          </div>
        )}

        {sources.length > 0 && (
          <div className="bg-gray-50 p-4 rounded-md border border-gray-200">
            <h2 className="font-semibold text-lg mb-2">Sources:</h2>
            <ul className="list-disc list-inside text-sm text-gray-600">
              {sources.map((src, index) => (
                <li key={index} className="mb-1">
                  From: <span className="font-medium">{src.metadata.source}</span> (Chunk {src.metadata.chunk_index})
                  <p className="text-xs italic text-gray-500 mt-0.5 line-clamp-2">{src.pageContent}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}