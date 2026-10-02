import { apiFetch } from '../apiClient';

export interface ConversationAttachment {
  document: string;
  chunks: number;
}

/** Attach a document to a conversation (personal RAG — this conversation only). */
export function uploadConversationAttachment(
  conversationId: string,
  file: File,
): Promise<{ filename: string; chunks: number }> {
  const form = new FormData();
  form.append('file', file);
  return apiFetch(`/guide/conversations/${conversationId}/attachments`, {
    method: 'POST',
    body: form,
  });
}

export function listConversationAttachments(
  conversationId: string,
): Promise<{ attachments: ConversationAttachment[] }> {
  return apiFetch(`/guide/conversations/${conversationId}/attachments`);
}
