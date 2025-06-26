// f:/New folder/corporate-compass-ai/app/admin/page.tsx
'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Redirect if not authenticated or not an admin
  if (status === 'loading') {
    return <div className="flex justify-center items-center h-screen"><p>Loading...</p></div>;
  }

  if (status === 'unauthenticated' || session?.user?.role !== 'admin') {
    router.push('/login'); // Redirect to login if not authenticated or not admin
    return null; // Don't render anything while redirecting
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      setSelectedFile(event.target.files[0]);
      setMessage(null);
    } else {
      setSelectedFile(null);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFile) {
      setMessage('Please select a file to upload.');
      return;
    }

    setLoading(true);
    setMessage(null);

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setMessage(`Success: ${data.message}`);
        setSelectedFile(null); // Clear selected file after successful upload
      } else {
        setMessage(`Error: ${data.message || 'Failed to upload file.'}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      setMessage('An unexpected error occurred during upload.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="p-8 max-w-md w-full bg-white rounded-lg shadow-md">
        <h1 className="text-2xl font-bold text-center text-gray-800 mb-6">Admin File Upload</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="file-upload" className="block text-sm font-medium text-gray-700">
              Select File (Text, PDF, etc.)
            </label>
            <input
              id="file-upload"
              type="file"
              onChange={handleFileChange}
              className="mt-1 block w-full text-sm text-gray-500
                file:mr-4 file:py-2 file:px-4
                file:rounded-md file:border-0
                file:text-sm file:font-semibold
                file:bg-blue-50 file:text-blue-700
                hover:file:bg-blue-100"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !selectedFile}
            className="w-full px-4 py-2 text-white bg-green-600 rounded-md hover:bg-green-700
              focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Uploading...' : 'Upload File'}
          </button>
        </form>

        {message && (
          <div className={`mt-4 p-3 rounded-md text-sm ${message.startsWith('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
            {message}
          </div>
        )}

        <p className="text-xs text-center text-gray-500 mt-4">
          Only admin users can access this page.
        </p>
      </div>
    </div>
  );
}