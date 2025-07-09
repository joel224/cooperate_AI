import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { conversations } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const userConversations = await db.query.conversations.findMany({
      where: eq(conversations.userId, session.user.id),
      orderBy: (conversations, { desc }) => [desc(conversations.createdAt)],
    });
    return NextResponse.json(userConversations);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}