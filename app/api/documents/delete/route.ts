import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { unlink } from 'fs/promises';
import path from 'path';
import { pinecone } from '@/lib/pinecone'; // Import your Pinecone client

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  // 1. Check for admin role
  if (!session || session.user?.role !== 'admin') {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }

  try {
    const { filename } = await request.json();

    if (!filename) {
      return NextResponse.json({ message: 'Filename is required' }, { status: 400 });
    }

    // Sanitize filename to prevent path traversal (important for deletion too)
    const sanitizedFilename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '');

    // 2. Delete vectors from Pinecone
    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME!);
    await pineconeIndex.deleteMany({ filter: { source: sanitizedFilename } });
    console.log(`Deleted vectors for ${sanitizedFilename} from Pinecone.`);

    // 3. Delete the file from the local uploads directory
    const filePath = path.join(process.cwd(), 'uploads', sanitizedFilename);
    await unlink(filePath);
    console.log(`Deleted file ${sanitizedFilename} from local storage.`);

    return NextResponse.json({ message: `Document '${sanitizedFilename}' deleted successfully.` });

  } catch (error) {
    console.error('Delete document API error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}