import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { pinecone } from '@/lib/pinecone';
import { conversations, messages, sources, users } from '@/drizzle/schema';
import { eq, inArray } from 'drizzle-orm';

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    // Step 1: Delete all user data from the relational database in a transaction
    await db.transaction(async (tx) => {
      console.log(`Starting data deletion for user: ${userId}`);

      // Find all conversation IDs for the user
      const userConversations = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.userId, userId));
      
      if (userConversations.length > 0) {
        const conversationIds = userConversations.map(c => c.id);

        // Find all message IDs within those conversations
        const conversationMessages = await tx.select({ id: messages.id }).from(messages).where(inArray(messages.conversationId, conversationIds));
        
        if (conversationMessages.length > 0) {
            const messageIds = conversationMessages.map(m => m.id);
            // Delete sources associated with the messages
            console.log(`Deleting ${messageIds.length} sources...`);
            await tx.delete(sources).where(inArray(sources.messageId, messageIds));
        }

        // Delete all messages in the conversations
        console.log(`Deleting messages for ${conversationIds.length} conversations...`);
        await tx.delete(messages).where(inArray(messages.conversationId, conversationIds));
      }

      // Delete all of the user's conversations
      console.log(`Deleting conversations for user: ${userId}`);
      await tx.delete(conversations).where(eq(conversations.userId, userId));

      // Finally, delete the user record itself
      console.log(`Deleting user record for: ${userId}`);
      await tx.delete(users).where(eq(users.id, userId));
    });

    console.log(`Database records deleted for user: ${userId}`);

    // Step 2: Delete all user-uploaded documents from the vector database
    if (process.env.PINECONE_INDEX_NAME) {
      console.log(`Deleting Pinecone vectors for user: ${userId}`);
      const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME);
      // This deletes all vectors where the metadata 'user_id' matches.
      // This includes both public and private documents uploaded by this user.
      await pineconeIndex.delete({
        filter: {
          'user_id': { '$eq': userId }
        }
      });
      console.log(`Pinecone vector deletion request sent for user: ${userId}`);
    }

    return NextResponse.json({ message: 'Account and all associated data deleted successfully.' }, { status: 200 });

  } catch (error) {
    console.error('Failed to delete user data:', error);
    return NextResponse.json({ message: 'An error occurred while deleting user data.' }, { status: 500 });
  }
}
