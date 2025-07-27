"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { Loader2 } from "lucide-react";
import { ChatMessage } from "~/components/chat-message";
import { ErrorMessage } from "~/components/error-message";
import { SignInModal } from "~/components/sign-in-modal";
import type { MessagePart } from "~/types";
import { isNewChatCreated } from "~/types";
import type { Message } from "ai";

interface ChatProps {
  userName: string;
  isAuthenticated: boolean;
  chatId?: string;
  initialMessages?: Message[];
}

export const ChatPage = ({
  userName,
  isAuthenticated,
  chatId,
  initialMessages,
}: ChatProps) => {
  const [showSignInModal, setShowSignInModal] = useState(false);
  const router = useRouter();

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    error,
    data,
  } = useChat({
    body: {
      chatId,
    },
    initialMessages,
    onFinish: (message, { usage, finishReason }) => {
      // Handle any cleanup if needed
      console.log("Chat finished:", { usage, finishReason });
    },
  });

  // Handle new chat creation by monitoring the data stream
  useEffect(() => {
    if (data && data.length > 0) {
      const latestData = data[data.length - 1];
      // Use type guard to check if the data is NewChatCreatedData
      if (isNewChatCreated(latestData)) {
        // Redirect to the new chat URL
        router.replace(`/?chatId=${latestData.chatId}`);
      }
    }
  }, [data, router]);

  const handleFormSubmit = (e: React.FormEvent) => {
    if (!isAuthenticated) {
      e.preventDefault();
      setShowSignInModal(true);
      return;
    }
    handleSubmit(e);
  };

  const getMessageParts = (message: Message): MessagePart[] => {
    // If message has parts, use them
    if (message.parts && message.parts.length > 0) {
      return message.parts;
    }

    // Fallback to content if parts are not available
    if (message.content) {
      return [{ type: "text", text: message.content }];
    }

    // Empty fallback
    return [];
  };

  return (
    <>
      <div className="flex flex-1 flex-col">
        <div
          className="mx-auto w-full max-w-[65ch] flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-track-gray-800 scrollbar-thumb-gray-600 hover:scrollbar-thumb-gray-500"
          role="log"
          aria-label="Chat messages"
        >
          {messages.map((message, index) => {
            return (
              <ChatMessage
                key={index}
                parts={getMessageParts(message)}
                role={message.role}
                userName={userName}
              />
            );
          })}
          {isLoading && (
            <div className="flex items-center gap-2 text-gray-400">
              <Loader2 className="size-4 animate-spin" />
              <span>AI is thinking...</span>
            </div>
          )}
          {error && (
            <ErrorMessage
              message={
                error.message.includes("401") ||
                error.message.includes("Unauthorized")
                  ? "Please sign in to continue chatting."
                  : error.message
              }
            />
          )}
        </div>

        <div className="border-t border-gray-700">
          <form
            onSubmit={handleFormSubmit}
            className="mx-auto max-w-[65ch] p-4"
          >
            <div className="flex gap-2">
              <input
                value={input}
                onChange={handleInputChange}
                placeholder="Say something..."
                autoFocus
                aria-label="Chat input"
                disabled={isLoading}
                className="flex-1 rounded border border-gray-700 bg-gray-800 p-2 text-gray-200 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="rounded bg-gray-700 px-4 py-2 text-white hover:bg-gray-600 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 disabled:hover:bg-gray-700"
              >
                {isLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Send"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      <SignInModal
        isOpen={showSignInModal}
        onClose={() => setShowSignInModal(false)}
      />
    </>
  );
};
