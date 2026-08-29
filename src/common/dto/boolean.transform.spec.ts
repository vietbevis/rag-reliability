import { plainToInstance } from 'class-transformer';
import { ToBoolean } from './boolean.transform';

class Sample {
  @ToBoolean()
  flag?: boolean;
}

const parse = (v: unknown): unknown =>
  plainToInstance(Sample, { flag: v }).flag;

describe('ToBoolean', () => {
  it('boolean giữ nguyên', () => {
    expect(parse(true)).toBe(true);
    expect(parse(false)).toBe(false);
  });

  it('"true"/"1" -> true ; "false"/"0" -> false (KHÁC Boolean("false"))', () => {
    expect(parse('true')).toBe(true);
    expect(parse('1')).toBe(true);
    expect(parse('false')).toBe(false);
    expect(parse('0')).toBe(false);
  });

  it('giá trị lạ giữ nguyên (để @IsBoolean báo lỗi)', () => {
    expect(parse('maybe')).toBe('maybe');
    expect(parse(undefined)).toBeUndefined();
  });
});
