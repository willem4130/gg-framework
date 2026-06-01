// OpenAI's server_error messages embed the request ID inline ("…request ID
// abc123 in your message"). Pull it out so we can surface it as a structured
// field rather than leaving it buried in the message.
export function extractRequestIdFromMessage(message: string): string | undefined {
  const match = message.match(/request ID ([a-z0-9-]{8,})/i);
  return match?.[1];
}
