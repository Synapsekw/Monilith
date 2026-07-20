import "server-only";
import OpenAI from "openai";
import { getServerEnv } from "@/lib/env.server";
import { AiNotConfiguredError } from "@/lib/ai/errors";

// The fixed, Pulse-managed embedding model + dimension (spec §4.5). An ANN index
// is only coherent if EVERY vector comes from the same model+dim, so semantic
// search does NOT use per-org BYO keys — it uses one platform key. Voyage
// (voyage-3.5-lite) is the documented swap behind this same EmbeddingClient
// interface; the item_embeddings.model column + content_hash make a swap a
// controlled re-index, not a silent corruption.
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIM = 1536;

export type EmbeddingResult = {
  vectors: number[][];
  inputTokens: number;
  model: string;
};

/** The abstracted embedding provider. `embed` maps N texts → N vectors. */
export interface EmbeddingClient {
  embed(texts: string[]): Promise<EmbeddingResult>;
}

/**
 * The minimal slice of the OpenAI embeddings API we depend on. Declaring it
 * lets tests inject a fake (no SDK, no network) and keeps createEmbeddingClient
 * provider-shaped for the future Voyage swap.
 */
export interface EmbeddingsApi {
  create(args: { model: string; input: string[] }): Promise<{
    data: { embedding: number[] }[];
    usage: { prompt_tokens: number };
  }>;
}

/**
 * Build an EmbeddingClient. Tests pass a fake `api`; production omits it and the
 * client lazily binds the real OpenAI embeddings API keyed by the PLATFORM
 * embedding key (getServerEnv().OPENAI_EMBEDDING_API_KEY), independent of any
 * org's ai_mode/BYO keys.
 */
export function createEmbeddingClient(
  api?: EmbeddingsApi,
  model: string = EMBEDDING_MODEL,
): EmbeddingClient {
  return {
    async embed(texts) {
      if (texts.length === 0) return { vectors: [], inputTokens: 0, model };
      const embeddings = api ?? platformEmbeddingsApi();
      const res = await embeddings.create({ model, input: texts });
      return {
        vectors: res.data.map((d) => d.embedding),
        inputTokens: res.usage.prompt_tokens,
        model,
      };
    },
  };
}

/** The real OpenAI embeddings API bound to the platform key (server-only). */
function platformEmbeddingsApi(): EmbeddingsApi {
  const key = getServerEnv().OPENAI_EMBEDDING_API_KEY;
  if (!key) throw new AiNotConfiguredError();
  const client = new OpenAI({ apiKey: key });
  return {
    async create({ model, input }) {
      const res = await client.embeddings.create({ model, input });
      return {
        data: res.data.map((d) => ({ embedding: d.embedding })),
        usage: { prompt_tokens: res.usage.prompt_tokens },
      };
    },
  };
}
