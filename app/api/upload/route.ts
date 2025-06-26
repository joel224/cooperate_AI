// f:/New folder/corporate-compass-ai/app/api/upload/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { writeFile, mkdir, rm } from 'fs/promises'; // Added rm for cleanup
import path from 'path';
import { LRUCache } from 'lru-cache'; // For caching embeddings
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'; // For text chunking
import { HuggingFaceInferenceEmbeddings } from '@langchain/community/embeddings/hf';
import { pinecone } from '@/lib/pinecone'; // Your Pinecone client
import { v4 as uuidv4 } from 'uuid'; // To generate unique IDs for vectors

// API route for handling file uploads.
// This route is intended for admin users to upload documents for the knowledge base.
// Initialize a cache for embeddings (larger for document chunks)
const embeddingCache = new LRUCache<string, number[]>({ max: 1000 }); // Cache up to 1000 embedding results
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  // Ensure user is authenticated and has 'admin' role.
  if (!session || session.user?.role !== 'admin') {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ message: 'No file uploaded' }, { status: 400 });
    }

    // 1. Validate file type and size
    const allowedMimeTypes = ['application/pdf', 'text/plain'];
    const maxFileSize = 10 * 1024 * 1024; // 10MB

    if (!allowedMimeTypes.includes(file.type)) {
      return NextResponse.json({ message: 'Invalid file type. Only PDF and text files are allowed.' }, { status: 400 });
    }

    if (file.size > maxFileSize) {
      return NextResponse.json({ message: `File size exceeds the limit of ${maxFileSize / (1024 * 1024)}MB.` }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let fileContent = '';
    const originalFileName = file.name;

    // 2. Extract content based on file type
    if (file.type === 'application/pdf') {
      // Dynamically import pdf-parse only when needed
      const pdf = (await import('pdf-parse')).default;
      const data = await pdf(buffer);
      fileContent = data.text;
    } else if (file.type === 'text/plain') {
      fileContent = buffer.toString('utf-8');
    }

    if (!fileContent) {
      return NextResponse.json({ message: 'Could not extract content from file.' }, { status: 500 });
    }

    // 3. Chunk the extracted text
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000, // Adjust as needed
      chunkOverlap: 200, // Adjust as needed
    });
    const docs = await textSplitter.createDocuments([fileContent]);

    // Add metadata to each chunk
    docs.forEach((doc, index) => { // Langchain's doc.metadata might contain complex objects like 'loc'
      const newMetadata: Record<string, any> = {
        source: originalFileName,
        chunk_index: index,
      };

      // Flatten 'loc' metadata if it exists and is an object
      if (doc.metadata && typeof doc.metadata === 'object' && 'loc' in doc.metadata && typeof doc.metadata.loc === 'object') {
        newMetadata.loc_lines_from = doc.metadata.loc.lines?.from;
        newMetadata.loc_lines_to = doc.metadata.loc.lines?.to;
      }
      doc.metadata = newMetadata;
    });

    // 4. Generate embeddings and store in Pinecone
    try {
      const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME!.trim());
      const embeddings = new HuggingFaceInferenceEmbeddings({ model: "BAAI/bge-m3" }); // Initialize outside if possible for performance

      // Helper function to get embedding from cache or generate and store
      const getCachedEmbedding = async (text: string): Promise<number[]> => {
        if (embeddingCache.has(text)) {
          return embeddingCache.get(text)!;
        } else {
          const embedding = await embeddings.embedQuery(text);
          embeddingCache.set(text, embedding);
          return embedding;
        }
      };

      // Embed all document chunks and prepare them for Pinecone
      const vectors = await Promise.all(docs.map(async (doc) => {
        const embedding = await getCachedEmbedding(doc.pageContent);
        return {
          id: uuidv4(), // Each vector needs a unique ID
          values: embedding,
          metadata: {
            ...doc.metadata,
            text: doc.pageContent, // Store the original text in metadata
          },
        };
      }));

      // Upsert vectors to Pinecone in batches for better performance and reliability.
      const batchSize = 100; // As recommended by Pinecone
      for (let i = 0; i < vectors.length; i += batchSize) {
        const batch = vectors.slice(i, i + batchSize);
        try {
          await pineconeIndex.upsert(batch);
          console.log(`Upserted batch ${i / batchSize + 1} of ${Math.ceil(vectors.length / batchSize)}`);
        } catch (batchError) {
          console.error(`Error upserting batch starting at index ${i}:`, batchError);
          // For now, we'll log and continue, but you could throw the error to stop.
        }
      }
      
      console.log(`File "${originalFileName}" processed and embeddings stored in Pinecone.`);
      return NextResponse.json({ message: `File "${originalFileName}" uploaded and processed successfully.` });
    } catch (embeddingError) {
      console.error('Error during embedding or Pinecone upsert:', embeddingError);
      // Optionally, save the raw content locally for debugging if Pinecone fails
      const uploadDir = path.join(process.cwd(), 'failed_uploads');
      const filePath = path.join(uploadDir, `${originalFileName}.txt`);
      await mkdir(uploadDir, { recursive: true }).catch(() => {}); // Ensure directory exists
      await writeFile(filePath, fileContent).catch((writeErr) => console.error('Failed to save raw content:', writeErr));

      return NextResponse.json(
        { message: 'File uploaded, but failed to process and store embeddings. Raw content saved for review.' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('File upload API error:', error);
    return NextResponse.json(
      { message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}