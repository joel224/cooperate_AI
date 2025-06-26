import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { LRUCache } from 'lru-cache';

// LangChain & AI imports
import { pinecone } from '@/lib/pinecone';
import { HuggingFaceInferenceEmbeddings } from '@langchain/community/embeddings/hf'; // Import for Hugging Face Inference API
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"; // For the LLM
import { PromptTemplate } from "@langchain/core/prompts"; // Needed for constructing the prompt
import { Document } from '@langchain/core/documents';
 
// Initialize a cache for embeddings
const embeddingCache = new LRUCache<string, number[]>({ max: 500 }); // Cache up to 500 embedding results

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  try {
    const { query } = await request.json();

    if (!query) {
      return NextResponse.json({ message: 'Query is required' }, { status: 400 });
    }

    console.log(`Received query: ${query}`);

    // 1. Create embedding for the user's query
    const embeddings = new HuggingFaceInferenceEmbeddings({ model: "BAAI/bge-m3" }); // Initialize outside if possible for performance
    let queryEmbedding: number[];

    // Check cache first
    if (embeddingCache.has(query)) {
      queryEmbedding = embeddingCache.get(query)!;
      console.log('Using cached embedding for query:', query);
    } else {
      queryEmbedding = await embeddings.embedQuery(query);
      embeddingCache.set(query, queryEmbedding);
      console.log('Generated and cached embedding for query:', query);
    }

    // 2. Retrieve relevant documents from Pinecone
 
    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME!.trim());
    const queryResult = await pineconeIndex.query({
      topK: 5, // Retrieve top 5 most relevant chunks
      vector: queryEmbedding,
      includeMetadata: true,
    });

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

    // 3. Initialize the LLM for answer generation
    const llm = new ChatGoogleGenerativeAI({
      apiKey: process.env.GEMINI_API_KEY,
      modelName: "gemini-2.5-flash",
      temperature: 0.3, // Adjust creativity
    });

    // 4. Construct prompt with the retrieved context
    const promptTemplate = PromptTemplate.fromTemplate(
      `You are a helpful AI assistant for the company "Corporate Compass".
      Use the following pieces of retrieved context to answer the question.
      If you don't know the answer from the context, say that you cannot find the information in the provided documents. Do not use outside knowledge.
      Your answer must be concise and professional.
      **Limit your answer to a maximum of three sentences.**

      Context:
      {context}

      Question: {question}

      Answer:`
    );

    console.log('Generating response with Gemini LLM...');
    const chain = promptTemplate.pipe(llm);
    const llmResponse = await chain.invoke({
      question: query,
      context: relevantDocs.map((doc) => doc.pageContent).join("\n\n"),
    });
    const aiResponse = llmResponse.content;

    return NextResponse.json({ response: aiResponse, sources: relevantDocs });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
