import { Pinecone } from '@pinecone-database/pinecone';


// Ensure PINECONE_API_KEY is set in your .env.local file
if (!process.env.PINECONE_API_KEY) {
  throw new Error('PINECONE_API_KEY environment variable not set.');
}

// The Pinecone client automatically resolves the host for serverless indexes
// based on the API key. The 'environment' property is not needed for v6+ clients.
export const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});