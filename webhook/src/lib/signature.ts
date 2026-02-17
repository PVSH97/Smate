import { createHmac } from "node:crypto";
import { config } from "../config.js";

export function verifySignature(
  rawBody: string,
  signatureHeader: string | undefined
): boolean {
  if (!config.META_APP_SECRET) {
    // Skip verification in dev when secret not configured
    return true;
  }

  if (!signatureHeader) return false;

  const expectedSignature = createHmac("sha256", config.META_APP_SECRET)
    .update(rawBody)
    .digest("hex");

  return signatureHeader === `sha256=${expectedSignature}`;
}
