import {
  sanitizeString,
  sanitizeTrace,
} from './trace-sanitizer.util';

describe('trace-sanitizer', () => {
  describe('sanitizeString', () => {
    it('che giấu OpenAI API key (sk-...)', () => {
      const input = 'Calling model with header: sk-abc12345678901234567890';
      expect(sanitizeString(input)).toBe(
        'Calling model with header: [REDACTED]',
      );
    });

    it('che giấu Google Gemini API key (AIza...)', () => {
      const input = 'Key used: AIzaSyD987654321012345678901234567890123';
      expect(sanitizeString(input)).toBe('Key used: [REDACTED]');
    });

    it('che giấu Bearer tokens', () => {
      const input = 'Authorization: Bearer mySecretToken123456789';
      expect(sanitizeString(input)).toBe('Authorization: [REDACTED]');
    });
  });

  describe('sanitizeTrace', () => {
    it('loại bỏ các trường có key nhạy cảm (apiKey, password, token)', () => {
      const trace = {
        stage: 'generation',
        latencyMs: 120,
        apiKey: 'real-api-key-12345',
        authHeader: 'Bearer xyz',
        nested: {
          password: 'supersecretpassword',
          safeField: 'valid content',
        },
      };

      const sanitized = sanitizeTrace(trace);

      expect(sanitized.stage).toBe('generation');
      expect(sanitized.apiKey).toBe('[REDACTED]');
      expect(sanitized.authHeader).toBe('[REDACTED]');
      expect(sanitized.nested.password).toBe('[REDACTED]');
      expect(sanitized.nested.safeField).toBe('valid content');
    });

    it('xử lý mảng và giá trị nguyên thủy an toàn', () => {
      const arr = [
        'Normal string',
        'Key: sk-12345678901234567890123456',
        { token: 'secret-token' },
      ];
      const sanitized = sanitizeTrace(arr);
      expect(sanitized[0]).toBe('Normal string');
      expect(sanitized[1]).toBe('Key: [REDACTED]');
      expect((sanitized[2] as { token: string }).token).toBe('[REDACTED]');
    });

    it('giữ nguyên null/undefined', () => {
      expect(sanitizeTrace(null)).toBeNull();
      expect(sanitizeTrace(undefined)).toBeUndefined();
    });
  });
});
