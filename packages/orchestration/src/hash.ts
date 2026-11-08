import { createHash, randomBytes } from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

export function requestHash(command: {
  schemaVersion: unknown;
  action: unknown;
  input: unknown;
}): string {
  return sha256Hex(
    canonicalize({
      schemaVersion: command.schemaVersion,
      action: command.action,
      input: command.input,
    }),
  );
}

export function traceId(): string {
  return randomBytes(16).toString("hex");
}
