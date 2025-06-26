import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { writeFile, readFile, mkdir } from 'fs/promises';
import path from 'path';

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { messageId, query, response, feedback } = await request.json();

    if (!messageId || !feedback) {
      return NextResponse.json(
        { message: 'messageId and feedback are required' },
        { status: 400 }
      );
    }

    const feedbackEntry = {
      id: messageId,
      timestamp: new Date().toISOString(),
      user: session.user?.email,
      query,
      response,
      feedback, // 'positive' or 'negative'
    };

    const feedbackDir = path.join(process.cwd(), 'feedback');
    const feedbackFile = path.join(feedbackDir, 'log.json');

    await mkdir(feedbackDir, { recursive: true });

    const currentFeedback = await readFile(feedbackFile, 'utf-8').catch(() => '[]');
    const feedbackData = JSON.parse(currentFeedback);
    feedbackData.push(feedbackEntry);

    await writeFile(feedbackFile, JSON.stringify(feedbackData, null, 2));

    return NextResponse.json({ message: 'Feedback received' });
  } catch (error) {
    console.error('Feedback API error:', error);
    return NextResponse.json(
      { message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}