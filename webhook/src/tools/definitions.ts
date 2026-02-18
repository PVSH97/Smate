import type Anthropic from "@anthropic-ai/sdk";

// Tools exposed to Claude — Mode B: draft-based persistence + read tools
export const tools: Anthropic.Tool[] = [
  // ── Read tools ──────────────────────────────────────────────
  {
    name: "find_customer",
    description:
      "Fuzzy search for a customer by name, phone, or RUT. Returns top 3 matches with confidence scores. Use before creating a new customer to avoid duplicates.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Customer name or business name to search for",
        },
        phone: {
          type: "string",
          description:
            "Customer phone number (international format) for exact match",
        },
        rut: {
          type: "string",
          description: "Chilean RUT (e.g. 12.345.678-K) for exact match",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_customer_card",
    description:
      "Get a customer's full profile including claims, signals, open tasks, and opportunities. Use to prepare for a conversation or generate a brief.",
    input_schema: {
      type: "object" as const,
      properties: {
        customer_id: {
          type: "string",
          description: "UUID of the customer",
        },
      },
      required: ["customer_id"],
    },
  },
  {
    name: "search_messages",
    description:
      "Search older conversation history by keyword. Use when the user references past topics or information not visible in the current message window.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search keywords (Spanish or English)",
        },
      },
      required: ["query"],
    },
  },
  // ── Write tool (Mode B gateway) ────────────────────────────
  {
    name: "parse_to_draft",
    description:
      "Package ALL commercial data you want to persist into a single draft for user confirmation. This is your ONLY way to save data — never persist directly. Each item specifies the tool and its input. After calling this, present the summary to the user and ask them to confirm.",
    input_schema: {
      type: "object" as const,
      properties: {
        items: {
          type: "array",
          description:
            "Array of data items to persist, each with a tool name and input",
          items: {
            type: "object",
            properties: {
              tool: {
                type: "string",
                enum: [
                  "create_customer",
                  "create_visit",
                  "create_tasks",
                  "create_signals",
                  "create_opportunity",
                  "create_claims",
                  "create_customer_brief",
                  "upsert_sku_packaging",
                ],
                description: "Which persistence tool to execute",
              },
              input: {
                type: "object",
                description: "The input parameters for the tool",
              },
            },
            required: ["tool", "input"],
          },
        },
        summary: {
          type: "string",
          description:
            "Human-readable summary in Spanish of what will be saved. Use WhatsApp formatting (*bold*, _italic_). List each item clearly.",
        },
      },
      required: ["items", "summary"],
    },
  },
];
