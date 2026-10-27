/**
 * What the coach transcript shows while a dropped iOS stream is being
 * reconciled with the saved chat.
 *
 * A non-credit failure keeps the typing indicator up and hides the red
 * banner until recovery polling finishes without a saved reply.
 */
export function coachChatRecoveryView(input: {
  status: string;
  hasError: boolean;
  checkingSavedReply: boolean;
  streamRecovered: boolean;
  creditError?: boolean;
}): {
  listStatus: string;
  showErrorBanner: boolean;
  showThinking: boolean;
} {
  if (input.streamRecovered) {
    return { listStatus: "ready", showErrorBanner: false, showThinking: false };
  }

  if (input.checkingSavedReply && !input.creditError) {
    const listStatus =
      input.status === "submitted" || input.status === "streaming"
        ? input.status
        : "streaming";
    return { listStatus, showErrorBanner: false, showThinking: true };
  }

  const showThinking =
    input.status === "submitted" || input.status === "streaming";
  return {
    listStatus: input.status,
    showErrorBanner: input.hasError,
    showThinking,
  };
}
