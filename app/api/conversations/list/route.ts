import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { conversations } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const userConversations = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        createdAt: conversations.createdAt,
      })
      .from(conversations)
      .where(eq(conversations.userId, session.user.id)) // CRITICAL: Only fetch for the current user
      .orderBy(desc(conversations.createdAt));

    return NextResponse.json(userConversations);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}