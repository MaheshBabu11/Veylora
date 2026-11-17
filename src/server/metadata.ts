import { createHash } from "node:crypto";

export function metadataSlug(value: string) {
  const normalized = value.trim().toLowerCase();
  const base = normalized.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "item";
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 10);
  return `${base}-${hash}`;
}
