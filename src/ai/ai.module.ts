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
import { FakeLlmProvider } from './llm/providers/fake-llm.provider';
import { GeminiLlmProvider } from './llm/providers/gemini-llm.provider';
import { OpenAiLlmProvider } from './llm/providers/openai-llm.provider';
import { TokenCounterService } from './tokenizer/token-counter.service';
import { NoopRerankerProvider } from './reranking/providers/noop-reranker.provider';
import { FakeRerankerProvider } from './reranking/providers/fake-reranker.provider';
import { LlmRerankerProvider } from './reranking/providers/llm-reranker.provider';
import { RerankerFactoryService } from './reranking/reranker-factory.service';
import { RerankerService } from './reranking/reranker.service';

/**
 * Tầng AI đa provider (PROMPT §4). Mọi lời gọi LLM/embedding/reranking trong service đều
 * đi qua {@link LlmService} / {@link EmbeddingService} / {@link RerankerService}; các provider cụ thể
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
    FakeLlmProvider,
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
    NoopRerankerProvider,
    FakeRerankerProvider,
    LlmRerankerProvider,
    RerankerFactoryService,
    RerankerService,
  ],
  exports: [
    LlmService,
    LlmFactoryService,
    EmbeddingService,
    EmbeddingFactoryService,
    TokenCounterService,
    AiProbeService,
    RerankerService,
    RerankerFactoryService,
  ],
})
export class AiModule {}
