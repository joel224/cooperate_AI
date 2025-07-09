'use client';

import React from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation'; // Corrected import order
import { useEffect, useState, useRef, ChangeEvent, DragEvent, useMemo } from 'react';
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
interface SourceDocument {
  pageContent: string;
  metadata: {
    source: string;
    chunk_index: number;
    loc_lines_from?: number;
    loc_lines_to?: number;
    is_public?: boolean;
    user_id?: string;
    text: string; // The full text of the chunk is stored in metadata.text
    // Add other metadata fi elds you might store
   // source?: string; // e.g., "uploads/document.pdf"
    loc?: { pageNumber?: number; [key: string]: any }; // Allow for other location details
    [key: string]: any; // Allow for other arbitrary metadata
  };
}

// Define a type for chat messages
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string; // This will be streamed
  sources?: SourceDocument[]; // Array of SourceDocument objects
}

// Add a type for public files
interface PublicFile {
  name: string;
  url: string;
}

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // State for admin file uploads
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set()); // State to track expanded sources
  const [feedbackSubmitted, setFeedbackSubmitted] = useState<{ [messageId: string]: 'positive' | 'negative' }>({});
  const [inputQuery, setInputQuery] = useState(''); // Renamed from 'input' to avoid confusion
  const [accessLevel, setAccessLevel] = useState<'public' | 'private' | 'roles'>('public');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const availableRoles = useMemo(() => ['sales', 'developer'], []);
  const [publicFiles, setPublicFiles] = useState<PublicFile[]>([]);
  const [conversationList, setConversationList] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [privateFiles, setPrivateFiles] = useState<PublicFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to the bottom of the chat when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Fetch public files on mount
  useEffect(() => {
    async function fetchPublicFiles() {
      try {
        const res = await fetch('/api/documents/list');
        if (res.ok) {
          const data = await res.json();
          setPublicFiles(data.files || []);
        }
      } catch (err) {
        // Optionally handle error
      }
    }
    fetchPublicFiles();
  }, []);

  // Fetch private files on mount and after an upload completes
  useEffect(() => {
    async function fetchPrivateFiles() {
      try {
        const res = await fetch('/api/documents/private');
        if (res.ok) {
          const data = await res.json();
          setPrivateFiles(data.files || []);
        }
      } catch (err) { /* Optionally handle error */ }
    }
    fetchPrivateFiles();
  }, [isUploading]); // Re-fetch when an upload completes

  // Fetch conversation history on mount and after a new chat is created
  useEffect(() => {
    async function fetchConversations() {
      try {
        const res = await fetch('/api/conversations/list');
        if (res.ok) {
          const data = await res.json();
          setConversationList(data || []);
        }
      } catch (err) { /* Optionally handle error */ }
    }
    fetchConversations();
  }, [conversationId]); // Re-fetch when conversationId changes

  const handleNewChat = () => {
    setMessages([]);
    setConversationId(null);
    setError(null);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputQuery.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: inputQuery.trim(),
    };

    setMessages((prevMessages) => [...prevMessages, userMessage]);
    setInputQuery('');
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          query: userMessage.content,
          conversationId: conversationId, // Pass current conversation ID
        }),
      });

      if (!response.ok || !response.body) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || 'Failed to get response from AI.'); // Throw to catch block
      }

      // Initialize an empty assistant message for streaming
      const assistantMessageId = uuidv4();
      const initialAssistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '', // Content will be streamed
        sources: [], // Sources will be populated from header
      };
      setMessages((prevMessages) => [...prevMessages, initialAssistantMessage]);

      // Get the conversation ID from the response header and set it for subsequent messages
      const newConversationId = response.headers.get('X-Conversation-Id');
      if (newConversationId) {
        setConversationId(newConversationId);
      }

      // Get sources from custom header
      const sourcesHeader = response.headers.get('X-Source-Documents');
      const retrievedSources: SourceDocument[] = sourcesHeader ? JSON.parse(atob(sourcesHeader)) : [];

      // Update the initial assistant message with sources
      setMessages((prevMessages) =>
        prevMessages.map((msg) =>
          msg.id === assistantMessageId ? { ...msg, sources: retrievedSources } : msg
        )
      );

      // Read the streaming text response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let streamedContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        streamedContent += chunk;
        // Update the content of the assistant message in real-time
        setMessages((prevMessages) =>
          prevMessages.map((msg) =>
            msg.id === assistantMessageId ? { ...msg, content: streamedContent } : msg
          )
        );
      }
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
            sources: assistantMessage.sources, // Pass the sources to the feedback API
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
    
    // Add access control parameters if the user is an admin
    if (session?.user?.role === 'admin') {
      formData.append('accessLevel', accessLevel);
      if (accessLevel === 'roles') {
        if (selectedRoles.length === 0) {
          alert('Please select at least one role for role-specific access.');
          return;
        }
        formData.append('roles', selectedRoles.join(','));
      }
    }

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

  const handleDeletePrivateFile = async (fileName: string) => {
    if (!window.confirm(`Are you sure you want to delete "${fileName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch('/api/documents/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: fileName }),
      });

      if (response.ok) {
        // Remove the file from the local state to update the UI instantly
        setPrivateFiles(prevFiles => prevFiles.filter(file => file.name !== fileName));
        alert(`Successfully deleted "${fileName}".`);
      } else {
        const errorData = await response.json();
        alert(`Error deleting file: ${errorData.message || 'Unknown error'}`);
      }
    } catch (error) {
      alert('An unexpected error occurred while deleting the file.');
    }
  };

  const handleSelectConversation = async (id: string) => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);
    setConversationId(id);
    try {
      const res = await fetch(`/api/messages/${id}`);
      if (res.ok) {
        const loadedMessages = await res.json();
        setMessages(loadedMessages);
      } else {
        throw new Error('Failed to load conversation.');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent handleSelectConversation from firing
    if (!window.confirm('Are you sure you want to delete this chat history?')) {
      return;
    }

    try {
      const response = await fetch('/api/conversations/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: id }),
      });

      if (response.ok) {
        setConversationList(prev => prev.filter(c => c.id !== id));
        if (conversationId === id) {
          handleNewChat(); // If deleting the active chat, start a new one
        }
        alert('Conversation deleted.');
      } else {
        const errorData = await response.json();
        alert(`Error: ${errorData.message}`);
      }
    } catch (error) {
      alert('An unexpected error occurred.');
    }
  };

  // Drag and drop handler for admin upload
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFileToUpload(e.dataTransfer.files[0]);
      setUploadStatus(`Selected: ${e.dataTransfer.files[0].name}`);
    }
  };

  if (status === 'loading') {
    return <div className="flex justify-center items-center h-screen"><p>Loading...</p></div>;
  }

  if (!session) {
    return null; // or a loading indicator, though the redirect should be fast
  }

  function handleDragAndDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();

    if (event.type === 'dragenter' || event.type === 'dragover') {
      setDragActive(true);
    } else if (event.type === 'dragleave') {
      setDragActive(false);
    } else if (event.type === 'drop') {
      setDragActive(false);
      if (event.dataTransfer.files && event.dataTransfer.files[0]) {
        setFileToUpload(event.dataTransfer.files[0]);
        setUploadStatus(`Selected: ${event.dataTransfer.files[0].name}`);
      }
    }
  }
  return (
    
      <div className="min-h-screen bg-gray-100">
        <header className="bg-white shadow p-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-800">Corporate Compass</h1>
          <div className="flex items-center space-x-4">
            <button
              onClick={handleNewChat}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 hover:bg-gray-300 rounded-md"
            >
            New Chat
          </button>
          <span className="text-sm text-gray-600">{session.user?.email}</span>
          <button 
            onClick={() => signOut({ callbackUrl: '/auth/signin' })}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
          >
            Sign Out
          </button>
        </div>
      </header>
      <div className="flex h-[calc(100vh-64px)]">
        {/* Sidebar for Conversations */}
        <aside className="w-64 bg-gray-800 text-white p-4 flex flex-col">
          <button
            onClick={handleNewChat}
            className="w-full mb-4 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
          >
            + New Chat
          </button>
          <h2 className="text-lg font-semibold mb-2">Chat History</h2>
          <div className="flex-1 overflow-y-auto">
            {conversationList.length === 0 ? (
              <p className="text-gray-400 text-sm">No past conversations.</p>
            ) : (
              <ul>
                {conversationList.map((conv) => (
                  <li key={conv.id}>
                    <button
                      onClick={() => handleSelectConversation(conv.id)}
                      className={`w-full text-left p-2 rounded-md text-sm truncate flex justify-between items-center ${
                        conversationId === conv.id ? 'bg-gray-700' : 'hover:bg-gray-600'
                      }`}
                    >
                      <span className="flex-1">{conv.title}</span>
                      <span onClick={(e) => handleDeleteConversation(conv.id, e)} className="p-1 rounded-full hover:bg-red-500">
                        &#x1F5D1; {/* Trash can icon */}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-6">
          <div className="flex flex-col h-full bg-white rounded-lg shadow overflow-hidden">
          {/* Public Files List - visible to all users */}
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold mb-2">Public Files</h2>
            {publicFiles.length === 0 ? (
              <p className="text-gray-500">No public files available.</p>
            ) : (
              <ul className="list-disc list-inside">
                {publicFiles.map((file) => (
                  <li key={file.url}>
                    <a href={file.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">{file.name}</a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Private Files List - visible to all users */}
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold mb-2">My Private Files</h2>
            {privateFiles.length === 0 ? (
              <p className="text-gray-500">You have not uploaded any private files.</p>
            ) : (
              <ul className="list-disc list-inside space-y-1">
                {privateFiles.map((file) => (
                  <li key={file.name} className="flex items-center justify-between">
                    <span>{file.name}</span>
                    <button
                      onClick={() => handleDeletePrivateFile(file.name)}
                      className="ml-4 px-2 py-1 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

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

          {/* File Upload Area - visible to all users */}
          <div className="p-4 border-t border-gray-200 bg-gray-50">
            <div
              className={`flex flex-col items-center justify-center border-2 border-dashed rounded-md p-4 transition-colors ${
                dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white'
              }`}
              onDragEnter={handleDragAndDrop}
              onDragOver={handleDragAndDrop}
              onDragLeave={handleDragAndDrop}
              onDrop={handleDragAndDrop}
            >
              <p className="mb-2 text-sm text-gray-700">Drag & drop a file here, or click to select</p>
              <label htmlFor="file-upload-input-dashboard" className="cursor-pointer px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
                Choose File
              </label>
              <input
                id="file-upload-input-dashboard"
                type="file"
                className="hidden"
                onChange={handleFileChange}
                accept=".pdf,.txt,.docx"
              />
              {fileToUpload && <p className="mt-2 text-xs text-gray-600">Selected: {fileToUpload.name}</p>}
              {uploadStatus && <p className="mt-2 text-xs text-gray-600">{uploadStatus}</p>}

              {/* Admin-only access control options */}
              {session.user?.role === 'admin' && (
                <div className="mt-4 w-full max-w-md space-y-3 text-sm">
                  <p className="font-medium text-gray-700">Document Access:</p>
                  <div className="flex items-center justify-around rounded-md bg-gray-200 p-1">
                    {(['public', 'roles', 'private'] as const).map((level) => (
                      <label key={level} className={`relative w-full cursor-pointer rounded-md py-1 text-center transition-colors ${accessLevel === level ? 'bg-white shadow-sm' : 'text-gray-600'}`}>
                        <input
                          type="radio"
                          name="accessLevel"
                          value={level}
                          checked={accessLevel === level}
                          onChange={() => setAccessLevel(level)}
                          className="absolute h-0 w-0 opacity-0"
                        />
                        {level === 'public' ? 'Public' : level === 'roles' ? 'Roles' : 'Private'}
                      </label>
                    ))}
                  </div>

                  {/* Conditional Roles Checkboxes */}
                  {accessLevel === 'roles' && (
                    <div className="pt-2 space-y-2 rounded-md border border-gray-200 bg-white p-3">
                      <p className="text-xs font-medium text-gray-600">Select roles that can access this document:</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-2">
                        {availableRoles.map(role => (
                          <div key={role} className="flex items-center">
                            <input
                              id={`role-${role}`}
                              type="checkbox"
                              value={role}
                              checked={selectedRoles.includes(role)}
                              onChange={(e) => {
                                setSelectedRoles(prev => 
                                  e.target.checked ? [...prev, role] : prev.filter(r => r !== role)
                                );
                              }}
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <label htmlFor={`role-${role}`} className="ml-2 block text-sm capitalize text-gray-900">
                              {role}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={handleFileUpload}
                disabled={!fileToUpload || isUploading || (session?.user?.role === 'admin' && accessLevel === 'roles' && selectedRoles.length === 0)}
                className="mt-3 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:bg-gray-400"
              >
                {isUploading 
                  ? 'Uploading...' 
                  : session?.user?.role === 'admin' 
                    ? accessLevel === 'public'
                      ? 'Upload to Public Knowledge Base'
                      : accessLevel === 'roles'
                        ? 'Upload for Selected Roles'
                        : 'Upload Private Document (For Admin)'
                    : 'Upload Private Document'}
              </button>
            </div>
          </div>

          {/* Chat Input Area */}
          <form onSubmit={handleSendMessage} className="p-4 border-t border-gray-200 flex">
            <input
              type="text"
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              placeholder={session.user?.role === 'admin' ? "Ask a question or upload a new document..." : "Ask a question about your documents..."}
              className="flex-1 p-3 border border-gray-300 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isLoading}
            />
            <button
              type="submit"
              className="px-6 py-3 bg-blue-600 text-white rounded-r-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-blue-300"
              disabled={isLoading || !inputQuery.trim()}
            >
              {isLoading ? 'Sending...' : 'Send'}
            </button>
          </form>
        </div>
      </main> 
      </div> 
    </div>
 
  );
}
