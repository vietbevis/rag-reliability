import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { ConfigError } from '../../common/errors';
import type {
  ChunkingStrategy,
  ChunkingStrategyName,
} from './chunking.interface';
import { FixedSizeChunkerService } from './fixed-size-chunker.service';
import { SemanticChunkerService } from './semantic-chunker.service';
import { StructureAwareChunkerService } from './structure-aware-chunker.service';

/** Chọn chiến lược chunking theo `CHUNKING_STRATEGY` (hoặc override để benchmark). */
@Injectable()
export class ChunkerFactoryService {
  private readonly registry: Record<ChunkingStrategyName, ChunkingStrategy>;

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    structure: StructureAwareChunkerService,
    fixed: FixedSizeChunkerService,
    semantic: SemanticChunkerService,
  ) {
    this.registry = { structure, fixed, semantic };
  }

  get defaultStrategyName(): ChunkingStrategyName {
    return this.config.get('chunking', { infer: true }).strategy;
  }

  create(strategy?: ChunkingStrategyName): ChunkingStrategy {
    const name = strategy ?? this.defaultStrategyName;
    const impl = this.registry[name];
    if (!impl)
      throw new ConfigError(`Chiến lược chunking không hợp lệ: ${name}`);
    return impl;
  }
}
