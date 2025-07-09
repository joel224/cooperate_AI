import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { pinecone } from '@/lib/pinecone';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME!.trim());
    const vectorDimension = Number(process.env.PINECONE_VECTOR_DIMENSION);
    if (!vectorDimension) {
      throw new Error('PINECONE_VECTOR_DIMENSION environment variable not set or invalid.');
    }
    const zeroVector = new Array(vectorDimension).fill(0);
    
    // CRITICAL: Filter for documents that belong ONLY to the current user.
    const queryResult = await pineconeIndex.query({
      vector: zeroVector,
      filter: { user_id: session.user.id },
      topK: 1000, // Fetch enough to find all unique document sources for the user.
      includeMetadata: true,
    });

    const documents = new Map<string, { name: string, url: string }>();
    queryResult.matches.forEach(match => {
      const source = match.metadata?.source as string;
      if (source && !documents.has(source)) {
        documents.set(source, { name: source, url: `#${source}` });
      }
    });

    return NextResponse.json({ files: Array.from(documents.values()) });
  } catch (error) {
    console.error('Error fetching private documents:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}