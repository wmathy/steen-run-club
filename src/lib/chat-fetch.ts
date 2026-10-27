/**
 * One immediate retry when Safari's keep-alive socket dies before the POST
 * produces a response (`TypeError: Load failed`). The body never left the
 * device, so the server has not saved the turn. A failure after headers
 * arrive is a Response, not a throw, and is not retried.
 */
export function isImmediateChatConnectionFailure(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const name = "name" in error && typeof error.name === "string" ? error.name : "";
  if (name === "AbortError") return false;
  const message =
    "message" in error && typeof error.message === "string" ? error.message : "";
  if (name === "TypeError") return true;
  return /load failed|failed to fetch|networkerror|network request failed/i.test(
    message,
  );
}

export const fetchChatWithImmediateRetry: typeof fetch = async (input, init) => {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    if (!isImmediateChatConnectionFailure(error)) throw error;
    return await fetch(input, init);
  }
};
