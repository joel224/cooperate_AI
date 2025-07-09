'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';

interface Version {
  version: number;
  status: 'active' | 'paused';
  is_latest: boolean;
  chunkCount: number;
}

interface AdminDocument {
  source: string;
  versions: Version[];
}

export default function AdminDocumentsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [documents, setDocuments] = useState<AdminDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());

  // Redirect if not an admin
  useEffect(() => {
    if (status === 'loading') return;
    if (!session || session.user?.role !== 'admin') {
      router.push('/dashboard');
    }
  }, [session, status, router]);

  const fetchDocuments = useCallback(async () => {
    if (!session || session.user?.role !== 'admin') return;
    setIsLoading(true);
    try {
      const response = await fetch('/api/admin/documents');
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to fetch documents.');
      }
      const data: AdminDocument[] = await response.json();
      setDocuments(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleDelete = async (source: string, version?: number) => {
    const confirmMessage = version
      ? `Are you sure you want to delete version ${version} of "${source}"?`
      : `Are you sure you want to delete ALL versions of "${source}"? This action cannot be undone.`;

    if (!confirm(confirmMessage)) return;

    try {
      const response = await fetch('/api/admin/documents', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, version }),
      });
      if (!response.ok) throw new Error((await response.json()).message);
      fetchDocuments(); // Refresh list
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleStatusChange = async (source: string, newStatus: 'active' | 'paused') => {
    try {
      const response = await fetch('/api/admin/documents/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, status: newStatus }),
      });
      if (!response.ok) throw new Error((await response.json()).message);
      fetchDocuments(); // Refresh list
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const toggleExpand = (source: string) => {
    setExpandedDocs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(source)) newSet.delete(source);
      else newSet.add(source);
      return newSet;
    });
  };

  if (status === 'loading' || !session || session.user?.role !== 'admin') {
    return <div className="flex justify-center items-center h-screen"><p>Loading & Verifying Access...</p></div>;
  }

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Manage Public Documents</h1>
      {isLoading ? <p>Loading documents...</p> : error ? <p className="text-red-500">{error}</p> : (
        <div className="space-y-4">
          {documents.map((doc) => (
            <div key={doc.source} className="bg-white shadow rounded-lg">
              <div className="px-6 py-4 flex items-center justify-between cursor-pointer" onClick={() => toggleExpand(doc.source)}>
                <h2 className="text-xl font-semibold text-gray-800">{doc.source}</h2>
                <div className="flex items-center space-x-4">
                  <span className={`px-2 py-1 text-xs font-semibold rounded-full ${doc.versions[0].status === 'active' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                    {doc.versions[0].status.toUpperCase()}
                  </span>
                  <button onClick={(e) => { e.stopPropagation(); handleStatusChange(doc.source, doc.versions[0].status === 'active' ? 'paused' : 'active'); }} className="text-sm text-blue-600 hover:underline">
                    {doc.versions[0].status === 'active' ? 'Pause' : 'Activate'}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(doc.source); }} className="text-sm text-red-600 hover:underline">
                    Delete All
                  </button>
                </div>
              </div>
              {expandedDocs.has(doc.source) && (
                <div className="border-t border-gray-200">
                  <ul className="divide-y divide-gray-200">
                    {doc.versions.map(v => (
                      <li key={v.version} className="px-6 py-3 flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-700">
                            Version {v.version}
                            {v.is_latest && <span className="ml-2 text-xs font-bold text-white bg-blue-500 px-2 py-0.5 rounded-full">LATEST</span>}
                          </p>
                          <p className="text-sm text-gray-500">{v.chunkCount} chunks</p>
                        </div>
                        <button onClick={() => handleDelete(doc.source, v.version)} className="text-sm text-red-500 hover:underline">
                          Delete Version
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
