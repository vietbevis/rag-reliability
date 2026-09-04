import { z, type ZodType } from 'zod';

/**
 * Chuyển JSON Schema (subset MCP dùng) → Zod runtime (target-state.md §4.2).
 * MCP tool `inputSchema` luôn `type:"object"`; hỗ trợ string/number/integer/
 * boolean/array/object/enum + `required` + `description`. Kiểu lạ ⇒ `z.unknown()`
 * (không ném — provider vẫn expose được tool).
 */
interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
}

export function jsonSchemaToZod(schema: JsonSchema | undefined): ZodType {
  if (!schema || typeof schema !== 'object') return z.unknown();

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const literals = schema.enum.map((v) =>
      z.literal(v as string | number | boolean),
    );
    const base: ZodType =
      literals.length === 1
        ? literals[0]!
        : z.union(literals as unknown as [ZodType, ZodType, ...ZodType[]]);
    return describe(base, schema.description);
  }

  const union = schema.anyOf ?? schema.oneOf;
  if (union && union.length > 0) {
    const members = union.map((s) => jsonSchemaToZod(s));
    return describe(
      members.length === 1
        ? members[0]!
        : z.union(members as [ZodType, ZodType, ...ZodType[]]),
      schema.description,
    );
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  switch (type) {
    case 'string':
      return describe(z.string(), schema.description);
    case 'number':
      return describe(z.number(), schema.description);
    case 'integer':
      return describe(z.number().int(), schema.description);
    case 'boolean':
      return describe(z.boolean(), schema.description);
    case 'array':
      return describe(
        z.array(jsonSchemaToZod(schema.items)),
        schema.description,
      );
    case 'object':
    default: {
      if (!schema.properties) {
        return describe(
          type === 'object' ? z.record(z.string(), z.unknown()) : z.unknown(),
          schema.description,
        );
      }
      const required = new Set(schema.required ?? []);
      const shape: Record<string, ZodType> = {};
      for (const [key, prop] of Object.entries(schema.properties)) {
        const inner = jsonSchemaToZod(prop);
        shape[key] = required.has(key) ? inner : inner.optional();
      }
      return describe(z.object(shape), schema.description);
    }
  }
}

function describe(t: ZodType, description?: string): ZodType {
  return description ? t.describe(description) : t;
}
