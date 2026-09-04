import { jsonSchemaToZod } from './json-schema-to-zod';

describe('jsonSchemaToZod', () => {
  it('object với properties + required', () => {
    const z = jsonSchemaToZod({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
      },
      required: ['name'],
    });
    expect(z.safeParse({ name: 'a' }).success).toBe(true);
    expect(z.safeParse({ age: 3 }).success).toBe(false); // thiếu name
    expect(z.safeParse({ name: 'a', age: 1.5 }).success).toBe(false); // không phải int
  });

  it('enum → union literal', () => {
    const z = jsonSchemaToZod({ type: 'string', enum: ['a', 'b'] });
    expect(z.safeParse('a').success).toBe(true);
    expect(z.safeParse('c').success).toBe(false);
  });

  it('array of string', () => {
    const z = jsonSchemaToZod({ type: 'array', items: { type: 'string' } });
    expect(z.safeParse(['x', 'y']).success).toBe(true);
    expect(z.safeParse([1]).success).toBe(false);
  });

  it('kiểu lạ → unknown (không ném)', () => {
    const z = jsonSchemaToZod({ type: 'weird' as unknown as string });
    expect(z.safeParse(123).success).toBe(true);
  });

  it('schema rỗng → unknown', () => {
    expect(jsonSchemaToZod(undefined).safeParse(null).success).toBe(true);
  });
});
