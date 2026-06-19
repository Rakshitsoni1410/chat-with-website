import { GoogleGenAI } from "@google/genai";

const CHAT_MODEL = "gemini-2.0-flash";
export const MIN_RELEVANCE_SCORE = 0.3;

function buildSystemPrompt(siteUrl, retrievedChunks) {
  const contextBlocks = retrievedChunks
    .map(
      (chunk, i) =>
        `[Source ${i + 1}] URL: ${chunk.url}
Title: ${chunk.title}
---
${chunk.text}`
    )
    .join("\n\n");

  return `You are a helpful assistant that answers questions about the website: ${siteUrl}

CONTEXT FROM THE WEBSITE:
${contextBlocks}

STRICT RULES YOU MUST FOLLOW:

1. Answer ONLY using information from the context above.
2. Do not use outside knowledge.
3. If the context does not contain enough information to answer the question, say exactly:

"I couldn't find information about that on this website."

Then briefly suggest what topics the site does cover based on the provided context.

4. Always cite your sources at the end of your answer using this exact format:

**Sources:**
- [Page Title](URL)

5. Only cite pages you actually used.
6. Be concise and direct.
7. If the question is partially answerable, answer what you can and explain what information is missing.`;
}

export class RAGChat {
  constructor() {
    this.ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
  }

  /**
   * Generate a streaming grounded answer.
   */
  async chat(
    siteUrl,
    query,
    retrievedChunks,
    conversationHistory = [],
    onChunk
  ) {
    const relevantChunks = retrievedChunks.filter(
      (c) => c.score >= MIN_RELEVANCE_SCORE
    );

    if (relevantChunks.length === 0) {
      const msg =
        "I couldn't find information about that on this website. The site's content may not cover this topic.";

      onChunk?.(msg);
      return msg;
    }

    const systemPrompt = buildSystemPrompt(siteUrl, relevantChunks);

    // Previous conversation
    const historyText = conversationHistory
      .slice(-6)
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    const prompt = `
${historyText}

USER QUESTION:
${query}
`;

    let fullText = "";

    if (onChunk) {
      // Streaming mode
      const stream = await this.ai.models.generateContentStream({
        model: CHAT_MODEL,
        contents: prompt,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.2,
          maxOutputTokens: 1000,
        },
      });

      for await (const chunk of stream) {
        const text = chunk.text || "";

        if (text) {
          fullText += text;
          onChunk(text);
        }
      }
    } else {
      // Non-streaming mode
      const response = await this.ai.models.generateContent({
        model: CHAT_MODEL,
        contents: prompt,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.2,
          maxOutputTokens: 1000,
        },
      });

      fullText = response.text;
    }

    return fullText;
  }
}