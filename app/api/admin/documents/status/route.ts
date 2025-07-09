import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import fs from 'fs/promises';
import path from 'path';

const PAUSED_DOCS_FILE = path.join(process.cwd(), 'paused_documents.json');

async function getPausedDocs(): Promise<string[]> {
  try {
    const fileContent = await fs.readFile(PAUSED_DOCS_FILE, 'utf-8');
    return JSON.parse(fileContent);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return []; // File doesn't exist, so no docs are paused
    }
    throw error;
  }
}

async function savePausedDocs(docs: string[]): Promise<void> {
  await fs.writeFile(PAUSED_DOCS_FILE, JSON.stringify(Array.from(new Set(docs)), null, 2));
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== 'admin') {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { source, status } = await request.json(); // status: 'active' or 'paused'
    if (!source || !status || !['active', 'paused'].includes(status)) {
      return NextResponse.json({ message: 'Source and a valid status (active/paused) are required' }, { status: 400 });
    }

    let pausedDocs = await getPausedDocs();
    const isPaused = pausedDocs.includes(source);

    if (status === 'paused' && !isPaused) {
      pausedDocs.push(source);
    } else if (status === 'active' && isPaused) {
      pausedDocs = pausedDocs.filter(doc => doc !== source);
    }

    await savePausedDocs(pausedDocs);

    return NextResponse.json({ message: `Document "${source}" status updated to ${status}.` });
  } catch (error) {
    console.error('Admin document status POST error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}