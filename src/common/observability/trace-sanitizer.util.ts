/**
 * Tiện ích khử rò rỉ thông tin nhạy cảm (secrets, API keys, passwords, bearer tokens)
 * khỏi telemetry, payload và trace log (PROMPT §38).
 */

const SENSITIVE_KEY_PATTERNS = [
  /api[-_]?key/i,
  /auth(?:orization)?/i,
  /secret/i,
  /password/i,
  /token/i,
  /credential/i,
  /private[-_]?key/i,
  /bearer/i,
];

const SECRET_VALUE_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{20,}/g, // OpenAI-style keys
  /AIza[0-9A-Za-z-_]{30,}/g, // Google API keys
  /anthropic-[a-zA-Z0-9_-]{20,}/g,
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
  /password\s*[:=]\s*[^\s,]+/gi,
];

const REDACTED = '[REDACTED]';

/**
 * Khử sạch các chuỗi secret trong văn bản.
 */
export function sanitizeString(text: string): string {
  if (!text || typeof text !== 'string') return text;
  let sanitized = text;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    sanitized = sanitized.replace(pattern, REDACTED);
  }
  return sanitized;
}

/**
 * Đệ quy làm sạch object / mảng trace, loại bỏ các key nhạy cảm và che giấu secret.
 */
export function sanitizeTrace<T>(input: T, depth = 0): T {
  if (depth > 10) return input; // Chống tràn stack đệ quy sâu
  if (input === null || input === undefined) return input;

  if (typeof input === 'string') {
    return sanitizeString(input) as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeTrace(item, depth + 1)) as unknown as T;
  }

  if (typeof input === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      const isSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pattern) =>
        pattern.test(key),
      );

      if (isSensitiveKey) {
        result[key] = REDACTED;
      } else {
        result[key] = sanitizeTrace(value, depth + 1);
      }
    }
    return result as unknown as T;
  }

  return input;
}
