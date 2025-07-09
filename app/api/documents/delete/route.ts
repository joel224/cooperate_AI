import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { pinecone } from '@/lib/pinecone';

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { source } = await request.json();
    if (!source) {
      return NextResponse.json({ message: 'Document source is required.' }, { status: 400 });
    }

    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME!.trim());
    const vectorDimension = Number(process.env.PINECONE_VECTOR_DIMENSION);
    if (!vectorDimension) {
      throw new Error('PINECONE_VECTOR_DIMENSION environment variable not set or invalid.');
    }
    const zeroVector = new Array(vectorDimension).fill(0);

    // Security Check: Find all chunks for the given source that belong to the current user.
    const queryResult = await pineconeIndex.query({
      vector: zeroVector,
      filter: { 
        '$and': [
          { source: source },
          { user_id: session.user.id } // CRITICAL: Ensures user can only query their own files for deletion
        ]
      },
      topK: 10000, // A high number to fetch all chunks for the source
      includeMetadata: false, // We only need IDs
      includeValues: false,
    });

    const idsToDelete = queryResult.matches.map(match => match.id);

    if (idsToDelete.length === 0) {
      return NextResponse.json({ message: 'Document not found or you do not have permission to delete it.' }, { status: 404 });
    }

    await pineconeIndex.deleteMany(idsToDelete);

    return NextResponse.json({ message: `Successfully deleted document "${source}".` });
  } catch (error) {
    console.error('Error deleting document:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}