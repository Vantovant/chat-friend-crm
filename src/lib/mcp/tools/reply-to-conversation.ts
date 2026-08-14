import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "reply_to_conversation",
  title: "Reply in a conversation",
  description:
    "Send a reply into an existing conversation via the existing send-message function, which auto-routes to Twilio or Maytapi based on which channel the contact last messaged in. Enforces the same 24-hour customer-service-window check and price/link safety validator as manual replies sent from the app — refuses rather than sending unsafe or out-of-window content.",
  inputSchema: {
    conversation_id: z
      .string()
      .uuid()
      .describe("conversations.id — get this from list_conversations or get_conversation_thread."),
    message_body: z.string().min(1).max(4000).describe("The exact final text to send. No templating is applied."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: async ({ conversation_id, message_body }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);

    const { data, error } = await supabase.functions.invoke("send-message", {
      body: { conversation_id, content: message_body },
    });

    if (error) {
      return {
        content: [{ type: "text", text: `send-message invocation failed: ${error.message}` }],
        structuredContent: { sent: false, reason: "invoke_error" },
        isError: true,
      };
    }
    if (!data?.ok) {
      return {
        content: [
          {
            type: "text",
            text: `Refused: [${data?.code}] ${data?.message}${data?.hint ? " — " + data.hint : ""}`,
          },
        ],
        structuredContent: { sent: false, ...data },
        isError: true,
      };
    }

    const result = { sent: true, ...data.message };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
