import ReactMarkdown, { type Components } from "react-markdown";
import type { ToolInvocation } from "ai";
import type { MessagePart } from "~/types";

interface ChatMessageProps {
  parts: MessagePart[];
  role: string;
  userName: string;
}

const components: Components = {
  // Override default elements with custom styling
  p: ({ children }) => <p className="mb-4 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-4 list-disc pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="mb-4 list-decimal pl-4">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  code: ({ className, children, ...props }) => (
    <code className={`${className ?? ""}`} {...props}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-4 overflow-x-auto rounded-lg bg-gray-700 p-4">
      {children}
    </pre>
  ),
  a: ({ children, ...props }) => (
    <a
      className="text-blue-400 underline"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
};

const Markdown = ({ children }: { children: string }) => {
  return <ReactMarkdown components={components}>{children}</ReactMarkdown>;
};

const ToolInvocationDisplay = ({
  toolInvocation,
}: {
  toolInvocation: ToolInvocation;
}) => {
  const getToolCallStatus = () => {
    switch (toolInvocation.state) {
      case "partial-call":
        return "Preparing tool call...";
      case "call":
        return "Calling tool...";
      case "result":
        return "Tool completed";
      default:
        return "Unknown state";
    }
  };

  const getToolCallColor = () => {
    switch (toolInvocation.state) {
      case "partial-call":
        return "text-yellow-400";
      case "call":
        return "text-blue-400";
      case "result":
        return "text-green-400";
      default:
        return "text-gray-400";
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-gray-600 bg-gray-800 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-400">
          Tool: {toolInvocation.toolName}
        </span>
        <span className={`text-sm ${getToolCallColor()}`}>
          {getToolCallStatus()}
        </span>
      </div>

      {toolInvocation.args && (
        <div className="mb-2">
          <span className="text-sm font-semibold text-gray-400">
            Arguments:
          </span>
          <pre className="mt-1 overflow-x-auto rounded bg-gray-700 p-2 text-sm">
            {JSON.stringify(toolInvocation.args, null, 2)}
          </pre>
        </div>
      )}

      {toolInvocation.state === "result" && "result" in toolInvocation && (
        <div>
          <span className="text-sm font-semibold text-gray-400">Result:</span>
          <pre className="mt-1 overflow-x-auto rounded bg-gray-700 p-2 text-sm">
            {JSON.stringify(toolInvocation.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export const ChatMessage = ({ parts, role, userName }: ChatMessageProps) => {
  const isAI = role === "assistant";

  return (
    <div className="mb-6">
      <div
        className={`rounded-lg p-4 ${
          isAI ? "bg-gray-800 text-gray-300" : "bg-gray-900 text-gray-300"
        }`}
      >
        <p className="mb-2 text-sm font-semibold text-gray-400">
          {isAI ? "AI" : userName}
        </p>

        <div className="prose prose-invert max-w-none">
          {parts.map((part, index) => {
            switch (part.type) {
              case "text":
                return <Markdown key={index}>{part.text}</Markdown>;
              case "tool-invocation":
                return (
                  <ToolInvocationDisplay
                    key={index}
                    toolInvocation={part.toolInvocation}
                  />
                );
              default:
                return null;
            }
          })}
        </div>
      </div>
    </div>
  );
};
