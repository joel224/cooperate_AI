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

  // Ensure user is authenticated.
  if (!session || !session.user?.id) {
    return NextResponse.json({ message: 'Authentication required' }, { status: 401 });
  }

  // --- Environment Variable Check ---
  // Fail early if essential API keys are missing. This prevents the app from hanging
  // on external API calls due to missing credentials.
  if (!process.env.HUGGING_FACE_API_KEY || !process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX_NAME || !process.env.PINECONE_VECTOR_DIMENSION) {
    console.error('CRITICAL: Missing required environment variables for upload (Hugging Face or Pinecone).');
    return NextResponse.json(
      { message: 'Server is missing required API key configuration for upload. Please check the .env.local file and restart the server.' },
      { status: 500 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    // RBAC parameters from the frontend
    const accessLevel = formData.get('accessLevel') as 'public' | 'private' | 'roles' | null;
    const rolesStr = formData.get('roles') as string | null; // e.g., "sales,developer"

    if (!file) {
      return NextResponse.json({ message: 'No file uploaded' }, { status: 400 });
    }

    // --- 1. File Validation ---
    const allowedMimeTypes = [
      'application/pdf', 
      'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // for .docx
    ];
    const maxFileSize = 15 * 1024 * 1024; // 15MB

    if (!allowedMimeTypes.includes(file.type)) {
      return NextResponse.json({ message: 'Invalid file type. Only PDF, TXT, and DOCX files are allowed.' }, { status: 400 });
    }

    if (file.size > maxFileSize) {
      return NextResponse.json({ message: `File size exceeds the limit of ${maxFileSize / (1024 * 1024)}MB.` }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let fileContent = '';
    const originalFileName = file.name;

    // --- 2. Content Extraction ---
    if (file.type === 'application/pdf') {
      // Dynamically import pdf-parse only when needed
      const pdf = (await import('pdf-parse')).default;
      const data = await pdf(buffer);
      fileContent = data.text;
    } else if (file.type === 'text/plain') {
      fileContent = buffer.toString('utf-8');
    } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      // Dynamically import mammoth for .docx files
      const mammoth = (await import('mammoth')).default;
      const result = await mammoth.extractRawText({ buffer });
      fileContent = result.value;
    }

    if (!fileContent) {
      return NextResponse.json({ message: 'Could not extract content from file.' }, { status: 500 });
    }

    // --- 3. Text Chunking ---
    // Split the large document text into smaller, manageable chunks. This is crucial for
    // creating effective embeddings and staying within model context limits.
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000, // Adjust as needed
      chunkOverlap: 200, // Adjust as needed
    });
    const docs = await textSplitter.createDocuments([fileContent]);

    const isAdmin = session.user?.role === 'admin';
    const isSharedUpload = isAdmin && (accessLevel === 'public' || accessLevel === 'roles');

    // --- 4. Metadata and Versioning ---
    // Prepare metadata for each chunk, including access control and versioning information.
    let version = 1;
    const newMetadata: Record<string, any> = { source: originalFileName };

    if (isSharedUpload) {
      const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME!.trim());
      
      // A zero vector is used for metadata-only queries in Pinecone when we don't need similarity search.
      const VECTOR_DIMENSION = Number(process.env.PINECONE_VECTOR_DIMENSION!);
      const zeroVector = Array(VECTOR_DIMENSION).fill(0);

      // Find the current latest version of this shared document to increment the version number.
      const latestVersionQuery = await pineconeIndex.query({
        vector: zeroVector,
        topK: 1, // We only need one to get the version number
        filter: { 
          source: originalFileName, 
          is_latest: true,
          '$or': [
            { is_public: true },
            { roles: { '$exists': true } }
          ]
        },
        includeMetadata: true,
        includeValues: false,
      });

      if (latestVersionQuery.matches.length > 0) {
        const latestVersion = (latestVersionQuery.matches[0].metadata?.version as number) || 0;
        version = latestVersion + 1;
        console.log(`New version detected for "${originalFileName}". Bumping to version ${version}.`);

        // Mark all chunks of the previous version as not latest.
        const allOldChunksQuery = await pineconeIndex.query({
          vector: zeroVector,
          topK: 10000, // A high number to fetch all chunks for the source
          filter: { 
            source: originalFileName, 
            is_latest: true,
            '$or': [
              { is_public: true },
              { roles: { '$exists': true } }
            ]
          },
          includeMetadata: false, // We only need IDs
          includeValues: false,
        });

        const chunkIdsToUpdate = allOldChunksQuery.matches.map(match => match.id);
        if (chunkIdsToUpdate.length > 0) {
          // Pinecone update is per-ID. We can do this in batches if needed, but for now, one by one is fine.
          for (const id of chunkIdsToUpdate) {
            await pineconeIndex.update({ id, setMetadata: { is_latest: false } });
          }
          console.log(`Marked ${chunkIdsToUpdate.length} chunks from version ${latestVersion} as not latest.`);
        }
      }

      // Set metadata for the new shared version
      if (accessLevel === 'public') {
        newMetadata.is_public = true;
      } else { // accessLevel === 'roles'
        const roles = rolesStr ? rolesStr.split(',').map(r => r.trim()).filter(r => r) : [];
        if (roles.length > 0) {
          newMetadata.roles = roles;
        } else {
          return NextResponse.json({ message: 'Roles must be provided for role-based access.' }, { status: 400 });
        }
      }
      newMetadata.version = version;
      newMetadata.is_latest = true;
    } else {
      // This is a private document (for any user, or an admin choosing 'private')
      newMetadata.user_id = session.user.id;
    }

    // Add metadata to each chunk
    docs.forEach((doc, index) => { // Langchain's doc.metadata might contain complex objects like 'loc'
      const chunkMetadata = { ...newMetadata, chunk_index: index };

      // Flatten 'loc' metadata if it exists and is an object
      if (doc.metadata && typeof doc.metadata === 'object' && 'loc' in doc.metadata && typeof doc.metadata.loc === 'object') {
        chunkMetadata.loc_lines_from = doc.metadata.loc.lines?.from;
        chunkMetadata.loc_lines_to = doc.metadata.loc.lines?.to;
      }
      doc.metadata = chunkMetadata;
    });

    // --- 5. Embedding and Upserting to Pinecone ---
    // Convert each document chunk into a vector embedding and store it in Pinecone
    // along with its metadata.
    try {
      const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME!.trim());
      const embeddings = new HuggingFaceInferenceEmbeddings({
        model: "BAAI/bge-m3",
        apiKey: process.env.HUGGING_FACE_API_KEY, // Use API key to avoid rate-limiting
      });

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