import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import fs from 'fs/promises';
import path from 'path';

// This is a placeholder for a real database.
// In a production environment, use a database like PostgreSQL, MongoDB, etc.
const FEEDBACK_FILE = path.join(process.cwd(), 'feedback_log.json');

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { query, response, feedback, sources } = await request.json();

    if (!query || !response || !feedback) {
      return NextResponse.json({ message: 'Missing required fields' }, { status: 400 });
    }

    const feedbackEntry = {
      userId: session.user.id,
      timestamp: new Date().toISOString(),
      query,
      response,
      feedback, // 'thumbs_up' or 'thumbs_down'
      sources: sources.map((s: any) => s.metadata.source), // Log source documents
    };

    // --- Database/Storage Logic ---
    // For demonstration, we'll append to a JSON file. This is NOT suitable for production.
    let feedbackData = [];
    try {
      const fileContent = await fs.readFile(FEEDBACK_FILE, 'utf-8');
      feedbackData = JSON.parse(fileContent);
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error; // Ignore "file not found"
    }
    feedbackData.push(feedbackEntry);
    await fs.writeFile(FEEDBACK_FILE, JSON.stringify(feedbackData, null, 2));

    console.log('Feedback received:', feedbackEntry);

    return NextResponse.json({ message: 'Feedback received successfully' });
  } catch (error) {
    console.error('Feedback API error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}