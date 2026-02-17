import type Anthropic from "@anthropic-ai/sdk";

export const tools: Anthropic.Tool[] = [
  {
    name: "lookup_customer",
    description:
      "Search for a customer by phone number or name. Use this to check if a customer already exists and retrieve their info before saving data.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone: {
          type: "string",
          description: "Customer phone number (international format)",
        },
        name: {
          type: "string",
          description: "Customer name or business name to search for",
        },
      },
    },
  },
  {
    name: "save_extraction",
    description:
      "Save a structured data extraction from the conversation. Use for any structured info that doesn't fit other tools (contact details, preferences, business info, etc).",
    input_schema: {
      type: "object" as const,
      properties: {
        extraction_type: {
          type: "string",
          description:
            "Type of extraction: contact_info, business_profile, preference, competitor_info, market_info, other",
        },
        data: {
          type: "object",
          description:
            "Structured JSON data extracted from the conversation. Include all relevant fields.",
        },
        confidence: {
          type: "number",
          description: "Confidence score 0-1 for this extraction",
        },
      },
      required: ["extraction_type", "data"],
    },
  },
  {
    name: "log_visit",
    description:
      "Log a sales visit that the user mentions. Captures visit summary, key discussion points, and next steps.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: {
          type: "string",
          description: "Brief summary of the visit",
        },
        key_points: {
          type: "array",
          items: { type: "string" },
          description: "Key discussion points or observations from the visit",
        },
        next_steps: {
          type: "array",
          items: { type: "string" },
          description: "Follow-up actions or next requirements",
        },
        visited_at: {
          type: "string",
          description:
            "When the visit happened (ISO 8601). Defaults to now if not mentioned.",
        },
      },
      required: ["summary", "key_points"],
    },
  },
  {
    name: "create_task",
    description:
      "Create an actionable task or to-do from the conversation. Use when the user mentions something they need to do or follow up on.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Short task title",
        },
        description: {
          type: "string",
          description: "Detailed task description",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent"],
          description: "Task priority level",
        },
        due_date: {
          type: "string",
          description: "Due date (YYYY-MM-DD format) if mentioned",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "save_signal",
    description:
      "Save a qualitative customer signal or intelligence. Use for objections, price sensitivity, competitor mentions, satisfaction indicators, buying intent, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        signal_type: {
          type: "string",
          description:
            "Type: objection, price_sensitivity, competitor_mention, satisfaction, buying_intent, churn_risk, expansion_opportunity, relationship_note",
        },
        content: {
          type: "string",
          description:
            "Description of the signal in natural language. Be specific.",
        },
      },
      required: ["signal_type", "content"],
    },
  },
  {
    name: "save_purchase",
    description:
      "Record a product purchase or order mentioned in the conversation. Captures product, supplier, pricing, and volume details.",
    input_schema: {
      type: "object" as const,
      properties: {
        product: {
          type: "string",
          description: "Product name",
        },
        supplier: {
          type: "string",
          description: "Supplier or vendor name if mentioned",
        },
        unit_price: {
          type: "number",
          description: "Price per unit",
        },
        quantity: {
          type: "number",
          description: "Quantity purchased",
        },
        unit: {
          type: "string",
          description: "Unit of measurement (kg, units, liters, etc)",
        },
        total: {
          type: "number",
          description: "Total purchase amount if mentioned or calculable",
        },
        purchased_at: {
          type: "string",
          description:
            "When the purchase happened (ISO 8601). Defaults to now.",
        },
      },
      required: ["product"],
    },
  },
];
