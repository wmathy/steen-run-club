import type { UIMessage } from "ai";
import { CoachMessageList } from "@/components/coach-message-list";
import { coachErrorMessage } from "@/lib/coach-errors";
import { coachChatRecoveryView } from "@/lib/chat-ui-state";

/**
 * Transcript plus the coach failure banner. While a non-credit send is still
 * being checked against the saved chat, this keeps the typing indicator and
 * leaves the red banner off.
 */
export function ChatRecoveryRegion({
  messages,
  status,
  error,
  checkingSavedReply,
  streamRecovered,
  creditError = false,
}: {
  messages: readonly UIMessage[];
  status: string;
  error: unknown;
  checkingSavedReply: boolean;
  streamRecovered: boolean;
  creditError?: boolean;
}) {
  const view = coachChatRecoveryView({
    status,
    hasError: error != null,
    checkingSavedReply,
    streamRecovered,
    creditError,
  });

  return (
    <>
      <CoachMessageList messages={messages} status={view.listStatus} />
      {view.showErrorBanner && error != null ? (
        <div
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {coachErrorMessage(error)}
        </div>
      ) : null}
    </>
  );
}
