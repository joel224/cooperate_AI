import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { LRUCache } from 'lru-cache';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { db } from '@/lib/db';
import { conversations, messages, sources } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

// LangChain & AI imports
import { pinecone } from '@/lib/pinecone';
import { HuggingFaceInferenceEmbeddings } from '@langchain/community/embeddings/hf'; // Import for Hugging Face Inference API
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"; // For the LLM
import { PromptTemplate } from "@langchain/core/prompts"; // Needed for constructing the prompt
import { BytesOutputParser } from '@langchain/core/output_parsers';
import { getBufferString, HumanMessage, AIMessage } from '@langchain/core/messages';
import { Document } from '@langchain/core/documents';
 
// Initialize a cache for embeddings
const embeddingCache = new LRUCache<string, number[]>({ max: 500 }); // Cache up to 500 embedding results

// --- Client Initializations ---
// Initialize clients outside the handler. This allows them to be reused across
// hot-reloads in development and warm invocations in a serverless environment.
const embeddings = new HuggingFaceInferenceEmbeddings({
  model: "BAAI/bge-m3",
  apiKey: process.env.HUGGING_FACE_API_KEY,
});

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-1.5-flash",
  temperature: 0.3,
  streaming: true,
});

const PAUSED_DOCS_FILE = path.join(process.cwd(), 'paused_documents.json');

async function getPausedDocs(): Promise<string[]> {
  try {
    const fileContent = await fs.readFile(PAUSED_DOCS_FILE, 'utf-8');
    return JSON.parse(fileContent);
  } catch (error: any) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

// Define a schema for strict input validation of the request body.
const chatRequestSchema = z.object({
  query: z.string().min(1, { message: "Query cannot be empty." }).max(2000, { message: "Query cannot exceed 2000 characters." }),
  conversationId: z.string().uuid("Invalid conversation ID.").nullable().optional(),
  source: z.string().optional(),
  version: z.string().optional(),
  persona: z.string().optional(), // Allow persona for future use
});


export async function POST(request: Request) {
  const requestId = uuidv4().slice(0, 8); // Short ID for cleaner logs
  console.log(`[${requestId}] --- START: New chat request ---`);

  const session = await getServerSession(authOptions);

  // Ensure user is authenticated for chat
  if (!session || !session.user?.id) {
    return NextResponse.json({ message: 'Authentication required for chat' }, { status: 401 });
  }

  // --- Environment Variable Check ---
  // Fail early if essential API keys are missing. This is a critical check to ensure
  // the application doesn't hang on external API calls due to missing credentials.
  if (!process.env.HUGGING_FACE_API_KEY || !process.env.GEMINI_API_KEY || !process.env.PINECONE_INDEX_NAME) {
    console.error(`[${requestId}] CRITICAL: Missing required environment variables (Hugging Face, Gemini, or Pinecone).`);
    return NextResponse.json(
      { message: 'Server is missing required API key configuration. Please check the .env.local file and restart the server.' },
      { status: 500 }
    );
  }

  try {
    // Validate the request body against the schema
    const body = await request.json();
    const validationResult = chatRequestSchema.safeParse(body);

    if (!validationResult.success) {
      // If validation fails, return a 400 error with details
      return NextResponse.json({ message: "Invalid request", errors: validationResult.error.flatten() }, { status: 400 });
    }

    const { query, conversationId: currentConversationId, source, version, persona = 'default' } = validationResult.data;

    // --- Legal & Compliance Safeguard ---
    // Check for sensitive keywords to provide a safe, standardized response
    // and bypass the regular AI processing for these specific topics.
    const sensitiveKeywords = ['harassment', 'fraud', 'illegal', 'unethical', 'whistleblower', 'discrimination', 'misconduct'];
    const lowerCaseQuery = query.toLowerCase();
    const isSensitiveQuery = sensitiveKeywords.some(keyword => lowerCaseQuery.includes(keyword));

    if (isSensitiveQuery && persona === 'default') {
      console.log(`[${requestId}] Sensitive query detected. Bypassing AI and providing standard guidance.`);
      
      const safeResponseContent = `It sounds like you are asking about a serious matter. It is important that such concerns are reported through the proper channels to ensure they are handled with confidentiality and care.

**Please do not share sensitive personal details or specifics of the situation with this AI assistant.**

For any concerns related to harassment, fraud, discrimination, or other potential misconduct, please follow the official company procedure:
1.  **Contact HR Directly:** You can reach out to the Human Resources department at hr@corporate-compass.com.
2.  **Anonymous Reporting Line:** The company provides an anonymous hotline for reporting sensitive issues. You can access it at the company's official whistleblower portal or by calling (800) 555-1234.
3.  **Review Company Policy:** For more details, please refer to the "Code of Conduct" and "Whistleblower Policy" documents.

Your confidentiality will be protected to the fullest extent possible.`;

      // Create a conversation and save messages, but use the canned response.
      let conversationId = currentConversationId;
      if (!conversationId) {
        conversationId = uuidv4();
        await db.insert(conversations).values({
          id: conversationId,
          userId: session.user.id,
          title: "Sensitive Inquiry", // Use a generic title for privacy
          createdAt: new Date(),
        });
      }
      
      await db.insert(messages).values({ id: uuidv4(), conversationId, role: 'user', content: query, createdAt: new Date() });
      await db.insert(messages).values({ id: uuidv4(), conversationId, role: 'assistant', content: safeResponseContent, createdAt: new Date() });

      // Return the safe response as a stream with a single chunk to maintain frontend compatibility.
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(safeResponseContent));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Source-Documents': Buffer.from(JSON.stringify([])).toString('base64'),
          'X-Conversation-Id': conversationId,
        },
      });
    }

    // --- 1. Conversation Management ---

    console.log(`[${requestId}] Received query: "${query}"`);

    console.log(`[${requestId}] Step 1: Managing conversation...`);

    let conversationId = currentConversationId;
    let chatHistory: (HumanMessage | AIMessage)[] = [];

    // If a conversationId is provided, load its history. Otherwise, create a new one.
    if (conversationId) { // Existing conversation
      const pastMessages = await db.query.messages.findMany({
        where: eq(messages.conversationId, conversationId),
        orderBy: (messages, { asc }) => [asc(messages.createdAt)],
      });
      chatHistory = pastMessages.map(msg =>
        msg.role === 'user' ? new HumanMessage(msg.content) : new AIMessage(msg.content)
      );
    } else { // New conversation
      // Create a new conversation
      conversationId = uuidv4();
      const newConversation = {
        id: conversationId,
        userId: session.user.id,
        title: query.substring(0, 50), // Use first part of query as title
        createdAt: new Date(),
      };
      await db.insert(conversations).values(newConversation);
      console.log(`[${requestId}] Created new conversation with ID: ${conversationId}`);
    }

    // Store the new user message in the database
    await db.insert(messages).values({
      id: uuidv4(),
      conversationId: conversationId,
      role: 'user',
      content: query,
      createdAt: new Date(),
    });

    // --- 2. RAG Pipeline: Embed Query ---
    // Convert the user's text query into a numerical vector (embedding)
    // to perform a similarity search in the vector database.
    console.log(`[${requestId}] Step 2: Embedding query...`);

    let queryEmbedding: number[];

    // Check cache first
    if (embeddingCache.has(query)) {
      queryEmbedding = embeddingCache.get(query)!;
      console.log(`[${requestId}] Using cached embedding for query.`);
    } else {
      queryEmbedding = await embeddings.embedQuery(query);
      embeddingCache.set(query, queryEmbedding);
      console.log(`[${requestId}] Generated and cached new embedding for query.`);
    }

    // --- 3. RAG Pipeline: Document Retrieval ---
    // Use the query embedding to search Pinecone for the most relevant document chunks.
    // This step includes Role-Based Access Control (RBAC) filtering.
    console.log(`[${requestId}] Step 3: Retrieving documents from Pinecone...`);
    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME!.trim());

    const pausedDocs = await getPausedDocs();

    let filter;
    const baseFilter = { source: { '$nin': pausedDocs } };

    if (source && version) {
      // --- Specific Version Query Logic ---
      // This is triggered when a user explicitly queries a specific version of a public document.
      console.log(`[${requestId}] Querying specific version: ${source} v${version}`);
      filter = {
        '$and': [
          baseFilter,
          { source: source },
          { version: parseInt(version, 10) },
          { is_public: true } // Ensure we only query public documents this way
        ]
      };
    } else { // --- Default Query Logic with RBAC ---

      // Build the access filter based on the user's session.
      const orClauses: Record<string, any>[] = [
        // 1. Documents private to the user
        { user_id: session.user.id },
        // 2. Latest version of all public documents
        { is_public: true, is_latest: true },
      ];

      // 3. If the user has a role, also include the latest version of documents for that role.
      if (session.user.role) {
        orClauses.push({ roles: { '$in': [session.user.role] }, is_latest: true });
      }

      filter = {
        '$and': [
          { '$or': orClauses },
          baseFilter
        ]
      };
    }

    console.log(`[${requestId}] Pinecone filter:`, JSON.stringify(filter, null, 2));

    const queryResult = await pineconeIndex.query({
      filter: filter, // Apply the new filter
      topK: 5, // Retrieve top 5 most relevant chunks
      vector: queryEmbedding,
      includeMetadata: true,
    });

    console.log(`[${requestId}] Found ${queryResult.matches.length} relevant document(s).`);

    // Map Pinecone results to LangChain Document format for consistency
    const relevantDocs = queryResult.matches.map(match => new Document({
      pageContent: match.metadata?.text as string || '',
      metadata: match.metadata || {},
    }));

    if (relevantDocs.length === 0) {
      return NextResponse.json({
        response: "I couldn't find any relevant information in the documents for your query.",
        sources: [],
      });
    }

    // --- 4. RAG Pipeline: Augment and Generate ---    
    // Construct a detailed prompt for the LLM, including the retrieved documents (context),
    // conversation history, and the user's question. This "augments" the generation process.
    const promptTemplate = PromptTemplate.fromTemplate(
      `You are a helpful AI assistant for the company "Corporate Compass".
      {version_context}
      Use the following pieces of retrieved context and the conversation history to answer the question.
      If you don't know the answer from the context, say that you cannot find the information in the provided documents. Do not use outside knowledge.
      Your answer must be concise and professional.

      Conversation History:
      {chat_history}

      Context:
      {context}

      Question: {question}

      Answer (in markdown):`
    );

    const outputParser = new BytesOutputParser();

    console.log('Generating response with Gemini LLM...');
    // Create the final processing chain: prompt -> LLM -> output parser
    const chain = promptTemplate.pipe(llm).pipe(outputParser);

    const versionContext = (source && version) 
      ? `You are answering a question about version ${version} of the document "${source}". State this clearly in your answer.`
      : "You are answering a question about the latest version of the available documents.";

    const llmStream = await chain.stream({
      chat_history: getBufferString(chatHistory),
      version_context: versionContext,
      question: query,
      context: relevantDocs.map((doc) => doc.pageContent).join("\n\n"),
    });

    // --- 5. Stream Response and Save to Database ---
    // Use a TransformStream to capture the full response while streaming
    // and capture the full text to save in the database once complete.
    let accumulatedResponse = '';
    const transformStream = new TransformStream({
      transform(chunk, controller) {
        const decodedChunk = new TextDecoder().decode(chunk);
        accumulatedResponse += decodedChunk;
        controller.enqueue(chunk); // Pass the chunk on to the client
      },
      async flush(controller) {
        // This block runs after the source stream is fully read.
        // Save the complete AI response and its sources to the database.
        if (accumulatedResponse) {
          const assistantMessageId = uuidv4();
          await db.insert(messages).values({
            id: assistantMessageId,
            conversationId: conversationId,
            role: 'assistant',
            content: accumulatedResponse,
            createdAt: new Date(),
          });

          if (relevantDocs.length > 0) {
            const sourcesToInsert = relevantDocs.map(doc => ({
              id: uuidv4(),
              messageId: assistantMessageId,
              pageContent: doc.pageContent,
              metadata: doc.metadata,
            }));
            await db.insert(sources).values(sourcesToInsert);
            console.log(`Saved ${sourcesToInsert.length} sources for message ${assistantMessageId}`);
          }
        }
      },
    });

    return new Response(llmStream.pipeThrough(transformStream), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Source-Documents': Buffer.from(JSON.stringify(relevantDocs)).toString('base64'),
        'X-Conversation-Id': conversationId, // Send back the conversation ID
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
