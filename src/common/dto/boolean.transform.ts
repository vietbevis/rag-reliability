import { Transform } from 'class-transformer';

/**
 * Decorator field DTO cho boolean nhận từ JSON / query-string / form-data.
 *
 * `class-transformer` `@Type(() => Boolean)` dùng `Boolean(v)` → `"false"` và
 * `"0"` đều thành `true`. Decorator này parse đúng: `true`/`"true"`/`"1"` → true,
 * `false`/`"false"`/`"0"` → false, còn lại giữ nguyên (để `@IsBoolean` báo lỗi).
 */
export const ToBoolean = (): PropertyDecorator =>
  Transform(({ value }): unknown => {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return value;
  });
