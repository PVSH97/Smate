import type Anthropic from "@anthropic-ai/sdk";

// Tools exposed to Claude — Mode B: draft-based persistence + read tools
export const tools: Anthropic.Tool[] = [
  // ── Read tools ──────────────────────────────────────────────
  {
    name: "find_customer",
    description:
      "Fuzzy search for a customer by name, phone, or RUT. Returns top 3 matches with confidence scores. Use before creating a new customer to avoid duplicates. If not found, proceed with the data you have — don't block the conversation.",
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
  {
    name: "get_approval_requests",
    description:
      "Get approval/credit requests for a customer or filter by status. Returns requests with provider info and latest events.",
    input_schema: {
      type: "object" as const,
      properties: {
        customer_id: {
          type: "string",
          description: "UUID of the customer (optional — omit to get all)",
        },
        status: {
          type: "string",
          description:
            "Filter by status: SUBMITTED, IN_REVIEW, APPROVED, PARTIAL_APPROVED, REJECTED, APPEALED, CLOSED",
        },
        limit: {
          type: "number",
          description: "Max results (default 20)",
        },
      },
      required: [],
    },
  },
  {
    name: "list_approval_providers",
    description:
      "List all approval providers configured for this organization (credit insurers, banks, internal committees, etc.).",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_product_equivalences",
    description:
      "Search product equivalences: competitor products mapped to internal SKUs. Filter by internal_sku (exact) or competitor_name (partial match).",
    input_schema: {
      type: "object" as const,
      properties: {
        internal_sku: {
          type: "string",
          description: "Internal SKU code (exact match)",
        },
        competitor_name: {
          type: "string",
          description: "Competitor product name (partial match)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_pending_tasks",
    description:
      "Get all open tasks across all customers. Use for agenda/to-do queries like 'qué tengo pendiente?' or 'qué tengo esta semana?'.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          description: "Filter by status (default: pending + in_progress)",
        },
        due_before: {
          type: "string",
          description: "Only tasks due on or before this date (YYYY-MM-DD)",
        },
        due_after: {
          type: "string",
          description: "Only tasks due on or after this date (YYYY-MM-DD)",
        },
        limit: {
          type: "number",
          description: "Max results (default 30)",
        },
      },
      required: [],
    },
  },
  // ── Write tool (Mode B gateway) ────────────────────────────
  {
    name: "parse_to_draft",
    description:
      "Save commercial data detected in the conversation. Groups all items for user confirmation before persisting. CRITICAL: Your summary to the user must use plain business language. Never mention tool names, field names, schemas, or processing steps. Show a clean commercial preview of what will be saved.",
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
                  "create_approval_provider",
                  "create_approval_request",
                  "update_approval_request",
                  "add_approval_event",
                  "update_task_status",
                  "update_opportunity_stage",
                  "update_customer",
                  "create_product_equivalence",
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
