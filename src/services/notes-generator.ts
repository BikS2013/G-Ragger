import { GoogleGenAI } from '@google/genai';

/**
 * Generate structured notes from a YouTube video transcript.
 *
 * Uses Gemini generateContent to produce Markdown-formatted notes
 * including summary, key points, important terms, and action items.
 *
 * @param ai - GoogleGenAI instance
 * @param model - Model name (e.g., "gemini-2.5-flash")
 * @param title - Video title (for context in the prompt)
 * @param transcript - Full transcript text
 * @returns Markdown-formatted notes string
 * @throws Error if generation fails or returns empty
 */
export async function generateNotes(
  ai: GoogleGenAI,
  model: string,
  title: string,
  transcript: string
): Promise<string> {
  const prompt = `Analyze the following transcript from a YouTube video titled "${title}" and generate structured notes in Markdown format.

Include the following sections:
1. **Summary**: A brief 2-3 sentence summary of the video content.
2. **Key Points**: A bulleted list of the main points discussed.
3. **Important Terms and Concepts**: Key terminology or concepts mentioned, with brief context.
4. **Action Items and Recommendations**: Any actionable advice or recommendations mentioned (omit this section if none are present).

Transcript:
${transcript}`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
  });

  const notes = response.text ?? '';
  if (!notes.trim()) {
    throw new Error('Notes generation returned empty response');
  }

  return notes;
}
