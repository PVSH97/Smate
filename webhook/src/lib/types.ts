import { z } from "zod";

export const webhookMessageSchema = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z
    .object({
      body: z.string(),
    })
    .optional(),
});

export type WebhookMessage = z.infer<typeof webhookMessageSchema>;

export const webhookEntrySchema = z.object({
  id: z.string(),
  changes: z.array(
    z.object({
      value: z.object({
        messaging_product: z.string(),
        metadata: z.object({
          display_phone_number: z.string(),
          phone_number_id: z.string(),
        }),
        contacts: z
          .array(
            z.object({
              profile: z.object({ name: z.string() }),
              wa_id: z.string(),
            })
          )
          .optional(),
        messages: z.array(webhookMessageSchema).optional(),
        statuses: z.array(z.unknown()).optional(),
      }),
      field: z.string(),
    })
  ),
});

export const webhookBodySchema = z.object({
  object: z.string(),
  entry: z.array(webhookEntrySchema),
});

export type WebhookBody = z.infer<typeof webhookBodySchema>;
