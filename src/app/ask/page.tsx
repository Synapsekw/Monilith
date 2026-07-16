import { AskChat } from "@/components/ai/ask/AskChat";

/** New-chat entry: an empty composer. The conversation row is minted on first
 *  send (createConversation), then the URL is rewritten client-side. */
export default function NewAskPage() {
  return <AskChat conversationId={null} initialMessages={[]} />;
}
