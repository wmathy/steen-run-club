import { ChatUI } from "@/components/chat-ui";
import { getCurrentUser } from "@/lib/auth";
import { loadChatMessages } from "@/lib/messages";

export default async function ChatPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const messages = await loadChatMessages(user.id);

  return (
    <div className="chat-shell flex min-h-0 flex-col">
      <ChatUI initialMessages={messages} />
    </div>
  );
}
