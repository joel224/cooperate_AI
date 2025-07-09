import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { pinecone } from '@/lib/pinecone';
import fs from 'fs/promises';
import path from 'path';

const PAUSED_DOCS_FILE = path.join(process.cwd(), 'paused_documents.json');

async function getPausedDocs(): Promise<string[]> {
  try {
    const fileContent = await fs.readFile(PAUSED_DOCS_FILE, 'utf-8');
    return JSON.parse(fileContent);
  } catch (error: any) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== 'admin') {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME!);
    const pausedDocs = await getPausedDocs();
    
    // This is a workaround to list documents. For large-scale apps, a separate metadata DB is better.
    const zeroVector = new Array(1024).fill(0);
    // Query for ALL public documents, not just the latest, to build the version history.
    const queryResult = await pineconeIndex.query({
      vector: zeroVector,
      filter: { is_public: true },
      topK: 10000, // High value to fetch as many vectors as possible
      includeMetadata: true,
    });

    // Process the flat list of chunks into a structured, versioned list.
    const documentsMap = new Map<string, { source: string, versions: Map<number, { version: number, status: string, is_latest: boolean, chunkCount: number }> }>();

    queryResult.matches.forEach(match => {
      const source = match.metadata?.source as string;
      const version = match.metadata?.version as number || 1;

      if (!source) return;

      if (!documentsMap.has(source)) {
        documentsMap.set(source, { source, versions: new Map() });
      }

      const doc = documentsMap.get(source)!;
      if (!doc.versions.has(version)) {
        doc.versions.set(version, {
          version,
          // A document is paused if its source name is in the paused list. This applies to all versions.
          status: pausedDocs.includes(source) ? 'paused' : 'active',
          is_latest: match.metadata?.is_latest === true,
          chunkCount: 0,
        });
      }
      doc.versions.get(version)!.chunkCount += 1;
    });

    // Convert the map to the final array structure for the API response.
    const documentList = Array.from(documentsMap.values()).map(doc => ({
      source: doc.source,
      // Sort versions in descending order
      versions: Array.from(doc.versions.values()).sort((a, b) => b.version - a.version),
    }));

    return NextResponse.json(documentList);
  } catch (error) {
    console.error('Admin documents GET error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== 'admin') {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { source, version } = await request.json(); // Now accepts an optional version
    if (!source) {
      return NextResponse.json({ message: 'Source filename is required' }, { status: 400 });
    }

    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME!);

    // Build a filter that targets all versions of a document, or a specific one.
    const deleteFilter: Record<string, any> = { source: source, is_public: true };
    if (version) {
      deleteFilter.version = version;
    }

    // Workaround for serverless indexes: fetch IDs then delete by ID.
    const zeroVector = new Array(1024).fill(0);
    const queryResult = await pineconeIndex.query({
      vector: zeroVector,
      filter: deleteFilter,
      topK: 10000, // Use a high value to ensure all chunks of a large document are found
      includeMetadata: false,
      includeValues: false,
    });

    const vectorIds = queryResult.matches.map(match => match.id);

    if (vectorIds.length > 0) await pineconeIndex.deleteMany(vectorIds);

    const message = version 
      ? `Version ${version} of document "${source}" deleted successfully.`
      : `All versions of document "${source}" deleted successfully.`;
    return NextResponse.json({ message });
  } catch (error) {
    console.error('Admin documents DELETE error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}