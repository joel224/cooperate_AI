import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { conversations, messages } from '@/drizzle/schema';
import { and, eq, asc } from 'drizzle-orm';

export async function GET(
  request: NextRequest,
  context: { params: { conversationId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  console.log(`API: Received request to fetch messages for conversation: ${context.params.conversationId}`);

  const { conversationId } = context.params;

  try {
    // 1. Authorization: Verify the user owns the conversation. This is a critical security step.
    console.log(`API: Verifying ownership for user ${session.user.id}...`);
    const conversation = await db.query.conversations.findFirst({
      where: and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, session.user.id)
      ),
    });
    console.log(`API: Ownership verification ${conversation ? 'successful' : 'failed'}.`);

    // If no conversation is found, it's either non-existent or belongs to another user.
    if (!conversation) {
      return NextResponse.json(
        { message: 'Conversation not found or access denied' },
        { status: 404 }
      );
    }

    // 2. Data Fetching: If authorized, retrieve all messages for the conversation, ordered by time.
    console.log(`API: Fetching messages and sources from database...`);
    const conversationMessages = await db.query.messages.findMany({
      where: eq(messages.conversationId, conversationId),
      orderBy: [asc(messages.createdAt)],
      with: {
        sources: true, // Eager load the related sources for each message
      },
    });

    console.log(`API: Found ${conversationMessages.length} messages. Sending response.`);

    return NextResponse.json(conversationMessages);
  } catch (error: any) {
    console.error(`Error fetching messages for conversation ${conversationId}:`, error);
    return NextResponse.json(
      { message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}