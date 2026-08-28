import { mockConfigService } from '../../config/config.mock';
import { ConfigError } from '../../common/errors';
import { TokenCounterService } from '../../ai/tokenizer/token-counter.service';
import { ChunkerFactoryService } from './chunker-factory.service';
import { FixedSizeChunkerService } from './fixed-size-chunker.service';
import { StructureAwareChunkerService } from './structure-aware-chunker.service';
import type { ChunkingStrategyName } from './chunking.interface';

function build(strategy: ChunkingStrategyName = 'structure') {
  const config = mockConfigService({ chunking: { strategy } });
  const tokens = new TokenCounterService();
  return new ChunkerFactoryService(
    config,
    new StructureAwareChunkerService(config, tokens),
    new FixedSizeChunkerService(config, tokens),
  );
}

describe('ChunkerFactoryService', () => {
  it('trả về strategy mặc định theo CHUNKING_STRATEGY', () => {
    expect(build('structure').create().name).toBe('structure');
    expect(build('fixed').create().name).toBe('fixed');
  });

  it('cho phép override để benchmark', () => {
    expect(build('structure').create('fixed').name).toBe('fixed');
  });

  it('ném ConfigError với strategy không hợp lệ', () => {
    expect(() => build().create('nope' as ChunkingStrategyName)).toThrow(
      ConfigError,
    );
  });
});
