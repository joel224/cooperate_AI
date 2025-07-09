import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { conversations } from '@/drizzle/schema';
import { and, eq } from 'drizzle-orm';

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { conversationId } = await request.json();
    if (!conversationId) {
      return NextResponse.json({ message: 'Conversation ID is required.' }, { status: 400 });
    }

    // CRITICAL SECURITY CHECK:
    // Ensure the conversation belongs to the user trying to delete it.
    const result = await db
      .delete(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.userId, session.user.id) // User can only delete their own conversations
        )
      )
      .returning({ id: conversations.id });

    if (result.length === 0) {
      return NextResponse.json({ message: 'Conversation not found or you do not have permission to delete it.' }, { status: 404 });
    }

    return NextResponse.json({ message: `Successfully deleted conversation.` });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}