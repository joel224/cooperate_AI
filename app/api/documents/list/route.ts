import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { readdir } from 'fs/promises';
import path from 'path';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  // 1. Check for admin role
  if (!session || session.user?.role !== 'admin') {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }

  try {
    const uploadDir = path.join(process.cwd(), 'uploads');
    let files: string[] = [];
    try {
      files = await readdir(uploadDir);
      // Filter out any system files like .DS_Store if present
      files = files.filter(name => !name.startsWith('.'));
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Directory doesn't exist yet, return empty array
        return NextResponse.json({ documents: [] });
      }
      throw error; // Re-throw other errors
    }

    return NextResponse.json({ documents: files });
  } catch (error) {
    console.error('List documents API error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}