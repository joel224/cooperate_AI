'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef, ChangeEvent, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid'; // For unique message IDs

// Define a type for LangChain Document objects
interface LangChainDocument {
  pageContent: string;
  metadata: {
    source?: string; // e.g., "uploads/document.pdf"
    loc?: { pageNumber?: number; [key: string]: any }; // Allow for other location details
    [key: string]: any; // Allow for other arbitrary metadata
  };
}

// Define a type for chat messages
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: LangChainDocument[]; // Array of LangChain Document objects
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/auth/signin');
    }
  }, [session, status, router]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // State for admin file uploads
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set()); // State to track expanded sources
  const [feedbackSubmitted, setFeedbackSubmitted] = useState<{ [messageId: string]: 'positive' | 'negative' }>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to the bottom of the chat when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: input.trim(),
    };

    setMessages((prevMessages) => [...prevMessages, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: userMessage.content }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to get response from AI.');
      }

      const data = await response.json();
      const assistantMessage: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: data.response,
        sources: data.sources,
      };
      setMessages((prevMessages) => [...prevMessages, assistantMessage]);
    } catch (err: any) {
      console.error('Chat API error:', err);
      setError(err.message || 'An unexpected error occurred.');
      // Add an error message to the chat for the user
      setMessages((prevMessages) => [
        ...prevMessages,
        {
          id: uuidv4(),
          role: 'assistant',
          content: `Error: ${err.message || 'Could not process your request.'}`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFeedback = async (
    messageId: string,
    feedback: 'positive' | 'negative'
  ) => {
    // Prevent re-submitting feedback
    if (feedbackSubmitted[messageId]) return;

    setFeedbackSubmitted((prev) => ({ ...prev, [messageId]: feedback }));

    // Find the message and the original user query that prompted it
    const messageIndex = messages.findIndex((msg) => msg.id === messageId);
    if (messageIndex > 0) {
      const assistantMessage = messages[messageIndex];
      const userMessage = messages[messageIndex - 1];

      try {
        await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageId: assistantMessage.id,
            query: userMessage.content,
            response: assistantMessage.content,
            feedback,
          }),
        });
      } catch (err) {
        console.error('Failed to submit feedback:', err);
        // Optionally revert the UI state on failure
        setFeedbackSubmitted((prev) => {
          const newState = { ...prev };
          delete newState[messageId];
          return newState;
        });
      }
    }
  };

  // Function to toggle source visibility for a message
  const toggleSources = (messageId: string) => {
    setExpandedSources((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setFileToUpload(event.target.files[0]);
      setUploadStatus(`Selected: ${event.target.files[0].name}`);
    } else {
      setFileToUpload(null);
      setUploadStatus('');
    }
  };

  const handleFileUpload = async () => {
    if (!fileToUpload) {
      setUploadStatus('Please select a file first.');
      return;
    }

    setIsUploading(true);
    setUploadStatus(`Uploading "${fileToUpload.name}" and processing...`);
    const formData = new FormData();
    formData.append('file', fileToUpload);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setUploadStatus(`Success: ${data.message || 'File processed.'}`);
        setFileToUpload(null);
        const fileInput = document.getElementById('file-upload-input-dashboard') as HTMLInputElement;
        if (fileInput) {
          fileInput.value = '';
        }
      } else {
        setUploadStatus(`Error: ${data.message || 'Upload failed.'}`);
      }
    } catch (err: any) {
      console.error('File upload error:', err);
      setUploadStatus(`Error: ${err.message || 'An unexpected error occurred.'}`);
    } finally {
      setIsUploading(false);
      // Clear status message after a few seconds
      setTimeout(() => setUploadStatus(''), 5000);
    }
  };

  if (status === 'loading') {
    return <div className="flex justify-center items-center h-screen"><p>Loading...</p></div>;
  }

  if (!session) {
    return null; // or a loading indicator, though the redirect should be fast
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow p-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800">Corporate Compass</h1>
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-600">{session.user?.email}</span>
          <button 
            onClick={() => signOut({ callbackUrl: '/auth/signin' })}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
          >
            Sign Out
          </button>
        </div>
      </header>
      <main className="p-6">
        <div className="flex flex-col h-[calc(100vh-160px)] bg-white rounded-lg shadow overflow-hidden">
          {/* Chat Messages Area */}
          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-gray-500 mt-10">
                <p className="text-lg">Welcome to Corporate Compass AI!</p>
                <p className="text-sm">Ask me anything about your documents.</p>
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-[70%] p-3 rounded-lg shadow-md ${
                    message.role === 'user'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 text-gray-800'
                  }`}
                >
                  <p className="font-semibold mb-1">
                    {message.role === 'user' ? 'You' : 'Corporate Compass AI'}
                  </p>
                  <p>{message.content}</p>
                  {message.sources && message.sources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-300 text-xs text-gray-600">
                      <p className="font-medium flex items-center justify-between">
                        Sources:
                        <button
                          onClick={() => toggleSources(message.id)}
                          className="ml-2 p-1 rounded-full hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400"
                          aria-expanded={expandedSources.has(message.id)}
                          aria-controls={`sources-${message.id}`}
                        >
                          {expandedSources.has(message.id) ? (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7"></path></svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                          )}
                        </button>
                      </p>
                      {expandedSources.has(message.id) && (
                        <ul id={`sources-${message.id}`} className="list-disc list-inside mt-2">
                          {message.sources.map((source, index) => (
                            <li key={index} className="mt-1">
                              {source.pageContent.substring(0, Math.min(source.pageContent.length, 200))}...{' '}
                              {source.metadata?.loc?.pageNumber && (
                                <span className="font-bold">
                                  (Page: {source.metadata.loc.pageNumber})
                                </span>
                              )}
                              {source.metadata?.source && (
                                <span className="font-bold ml-1">
                                  (File: {source.metadata.source.split(/[\\/]/).pop()})
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {message.role === 'assistant' && !message.content.startsWith('Error:') && (
                    <div className="mt-2 flex items-center space-x-2">
                      <button
                        onClick={() => handleFeedback(message.id, 'positive')}
                        disabled={!!feedbackSubmitted[message.id]}
                        className={`p-1 rounded-full ${
                          feedbackSubmitted[message.id] === 'positive'
                            ? 'bg-green-200 text-green-700'
                            : 'hover:bg-gray-300'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                        aria-label="Good response"
                      >
                        {/* Thumbs Up SVG */}
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.562 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" /></svg>
                      </button>
                      <button
                        onClick={() => handleFeedback(message.id, 'negative')}
                        disabled={!!feedbackSubmitted[message.id]}
                        className={`p-1 rounded-full ${
                          feedbackSubmitted[message.id] === 'negative'
                            ? 'bg-red-200 text-red-700'
                            : 'hover:bg-gray-300'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                        aria-label="Bad response"
                      >
                        {/* Thumbs Down SVG */}
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M18 9.5a1.5 1.5 0 11-3 0v-6a1.5 1.5 0 013 0v6zM14 9.667v-5.43a2 2 0 00-1.106-1.79l-.05-.025A4 4 0 0011.057 2H5.642a2 2 0 00-1.962 1.608l-1.2 6A2 2 0 004.438 12H8v4a2 2 0 002 2 1 1 0 001-1v-.667a4 4 0 01.8-2.4l1.2-2.4a4 4 0 00.8-2.4z" /></svg>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="max-w-[70%] p-3 rounded-lg shadow-md bg-gray-200 text-gray-800">
                  <p className="font-semibold mb-1">Corporate Compass AI</p>
                  <p>Thinking...</p>
                </div>
              </div>
            )}
            {error && <p className="text-red-500 text-center mt-4">{error}</p>}
            <div ref={messagesEndRef} /> {/* Scroll anchor */}
          </div>

          {/* Admin Upload Area - only visible to admins */}
          {session.user?.role === 'admin' && (
            <div className="p-4 border-t border-gray-200 bg-gray-50">
              <div className="flex items-center space-x-2">
                <label
                  htmlFor="file-upload-input-dashboard"
                  className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md cursor-pointer hover:bg-gray-50"
                >
                  Choose File
                </label>
                <input
                  id="file-upload-input-dashboard"
                  type="file"
                  className="hidden"
                  onChange={handleFileChange}
                  accept=".pdf"
                />
                <button
                  onClick={handleFileUpload}
                  disabled={!fileToUpload || isUploading}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:bg-gray-400"
                >
                  {isUploading ? 'Uploading...' : 'Upload to Knowledge Base'}
                </button>
                {uploadStatus && (
                  <p className="text-xs text-gray-600 flex-1 truncate">
                    {uploadStatus}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Chat Input Area */}
          <form onSubmit={handleSendMessage} className="p-4 border-t border-gray-200 flex">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={session.user?.role === 'admin' ? "Ask a question or upload a new document..." : "Ask a question about your documents..."}
              className="flex-1 p-3 border border-gray-300 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isLoading}
            />
            <button
              type="submit"
              className="px-6 py-3 bg-blue-600 text-white rounded-r-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-blue-300"
              disabled={isLoading || !input.trim()}
            >
              {isLoading ? 'Sending...' : 'Send'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
