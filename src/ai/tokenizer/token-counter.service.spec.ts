import { TokenCounterService } from './token-counter.service';

describe('TokenCounterService', () => {
  const svc = new TokenCounterService();

  it('đếm 0 token cho chuỗi rỗng', () => {
    expect(svc.count('')).toBe(0);
  });

  it('đếm token tăng theo độ dài', () => {
    const short = svc.count('hello');
    const long = svc.count('hello world this is a longer sentence');
    expect(long).toBeGreaterThan(short);
  });

  it('fallback về encoder cơ sở với model không xác định', () => {
    expect(svc.count('xin chào', 'model-khong-ton-tai')).toBeGreaterThan(0);
  });

  it('countMessages cộng overhead cho mỗi message', () => {
    const one = svc.countMessages([{ role: 'user', content: 'hi' }]);
    const two = svc.countMessages([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
    ]);
    expect(two).toBeGreaterThan(one);
  });
});
