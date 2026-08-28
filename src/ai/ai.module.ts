import { Global, Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiProbeService } from './ai-probe.service';
import { EmbeddingFactoryService } from './embeddings/embedding-factory.service';
import { EmbeddingService } from './embeddings/embedding.service';
import { CustomEmbeddingProvider } from './embeddings/providers/custom-embedding.provider';
import { FakeEmbeddingProvider } from './embeddings/providers/fake-embedding.provider';
import { GeminiEmbeddingProvider } from './embeddings/providers/gemini-embedding.provider';
import { OpenAiEmbeddingProvider } from './embeddings/providers/openai-embedding.provider';
import { LlmFactoryService } from './llm/llm-factory.service';
import { LlmService } from './llm/llm.service';
import { AnthropicLlmProvider } from './llm/providers/anthropic-llm.provider';
import { CustomLlmProvider } from './llm/providers/custom-llm.provider';
import { GeminiLlmProvider } from './llm/providers/gemini-llm.provider';
import { OpenAiLlmProvider } from './llm/providers/openai-llm.provider';
import { TokenCounterService } from './tokenizer/token-counter.service';

/**
 * Tầng AI đa provider (PROMPT §4). Mọi lời gọi LLM/embedding trong service đều
 * đi qua {@link LlmService} / {@link EmbeddingService}; các provider cụ thể
 * được wire ở đây và chọn qua env, không bao giờ bị tham chiếu từ business logic.
 */
@Global()
@Module({
  controllers: [AiController],
  providers: [
    OpenAiLlmProvider,
    GeminiLlmProvider,
    AnthropicLlmProvider,
    CustomLlmProvider,
    LlmFactoryService,
    LlmService,
    OpenAiEmbeddingProvider,
    GeminiEmbeddingProvider,
    CustomEmbeddingProvider,
    FakeEmbeddingProvider,
    EmbeddingFactoryService,
    EmbeddingService,
    TokenCounterService,
    AiProbeService,
  ],
  exports: [
    LlmService,
    LlmFactoryService,
    EmbeddingService,
    EmbeddingFactoryService,
    TokenCounterService,
    AiProbeService,
  ],
})
export class AiModule {}
