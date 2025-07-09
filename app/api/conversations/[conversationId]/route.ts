import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { messages, conversations } from '@/drizzle/schema';
import { and, eq } from 'drizzle-orm';

export async function GET(
  request: Request,
  { params }: { params: { conversationId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const { conversationId } = params;

  try {
    // Security check: Ensure the conversation belongs to the user
    const conversation = await db.query.conversations.findFirst({
      where: and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, session.user.id)
      ),
    });

    if (!conversation) {
      return NextResponse.json({ message: 'Conversation not found or access denied' }, { status: 404 });
    }

    const conversationMessages = await db.query.messages.findMany({
      where: eq(messages.conversationId, conversationId),
      orderBy: (messages, { asc }) => [asc(messages.createdAt)],
    });

    return NextResponse.json(conversationMessages);
  } catch (error) {
    console.error(`Error fetching messages for conversation ${conversationId}:`, error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}