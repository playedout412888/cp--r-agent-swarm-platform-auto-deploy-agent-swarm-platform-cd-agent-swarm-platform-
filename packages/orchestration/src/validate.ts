import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import commandSchema from "../../contracts/command.v1.schema.json" with { type: "json" };
import dailyBriefSchema from "../../contracts/daily-brief-result.v1.schema.json" with { type: "json" };
import healthResultSchema from "../../contracts/health-result.v1.schema.json" with { type: "json" };

type AjvInstance = {
  compile<T>(schema: object): ((data: unknown) => data is T) & { errors: unknown };
  errorsText(errors: unknown): string;
};
type AjvCtor = new (opts: { allErrors: boolean; strict: boolean }) => AjvInstance;
const Ajv2020 = Ajv2020Module as unknown as AjvCtor;
const addFormats = addFormatsModule as unknown as (ajv: AjvInstance) => void;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

export type CommandInput = {
  schemaVersion: "1.0";
  idempotencyKey: string;
  action: "system.health" | "project.dailyBrief";
  input: Record<string, unknown>;
};

const validateCommandAjv = ajv.compile<CommandInput>(commandSchema);
const validateHealthResultAjv = ajv.compile(healthResultSchema);
const validateBriefResultAjv = ajv.compile(dailyBriefSchema);

export function validateCommand(body: unknown): CommandInput {
  if (validateCommandAjv(body)) {
    return body;
  }
  const detail = ajv.errorsText(validateCommandAjv.errors);
  const error = new Error(`invalid command: ${detail}`);
  (error as Error & { statusCode?: number; code?: string }).statusCode = 400;
  (error as Error & { statusCode?: number; code?: string }).code = "schema_invalid";
  throw error;
}

export function assertHealthResult(value: unknown): void {
  if (!validateHealthResultAjv(value)) {
    throw new Error(
      `invalid health result: ${ajv.errorsText(validateHealthResultAjv.errors)}`,
    );
  }
}

export function assertBriefResult(value: unknown): void {
  if (!validateBriefResultAjv(value)) {
    throw new Error(
      `invalid brief result: ${ajv.errorsText(validateBriefResultAjv.errors)}`,
    );
  }
}

export function contractsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../contracts");
}

export function readOpenApi(): string {
  return readFileSync(join(contractsDir(), "openapi.yaml"), "utf8");
}
