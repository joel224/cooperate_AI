import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(), // Using text for UUIDs
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  messageId: text('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  pageContent: text('page_content').notNull(),
  metadata: text('metadata', { mode: 'json' }).notNull(),
});

export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  sources: many(sources),
}));

export const sourcesRelations = relations(sources, ({ one }) => ({
  message: one(messages, {
    fields: [sources.messageId],
    references: [messages.id],
  }),
}));