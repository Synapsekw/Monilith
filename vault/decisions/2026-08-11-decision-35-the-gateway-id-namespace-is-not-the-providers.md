---
type: adr
date: 2026-08-11
status: accepted
tags: [decision, ai, providers, gotcha]
related: ["[[2026-08-11-1501-provider-model-layer-spec-1]]"]
---

# Decision 35 — the Gateway's model-id namespace is not the providers'

## Context

The provider/model layer takes its catalog from the public Vercel AI Gateway feed
(`https://ai-gateway.vercel.sh/v1/models`), which is authoritative for pricing and capabilities and
costs nothing to read. The spec assumed that splitting a gateway id on `/` yields a
provider-native model id.

It does not. The Gateway publishes `claude-haiku-4.5` and `claude-opus-4.8`; Anthropic's own API
wants `claude-haiku-4-5` and `claude-opus-4-8`. `claude-sonnet-5` and `claude-opus-5` happen to
match, which is exactly why nothing failed for months. The Gateway exposes no native id anywhere —
`/v1/models/{id}/endpoints` returns only a display name and repeats the gateway id.

This was found when a catalog refresh **retired `claude-haiku-4-5`**, the model `model-map` routed
`item_assist` and `column_fill` to. Under a BYO key, a gateway id posted to a provider's own API is
a 404, so it would have broken the core promise of the feature.

Two further facts emerged while fixing it:

- **Anthropic lists only dated snapshots for older families.** `/v1/models` returns
  `claude-haiku-4-5-20251001`, never the bare alias — even though the alias works when called.
- **The divergence is Anthropic-only.** Every dotted OpenAI gateway id matched natively.

## Decision

The Gateway stays authoritative for **pricing and capabilities**. Each provider is authoritative
for **its own ids**. Normalisation only ever *proposes* candidates; the provider's own model list is
the judge; an unmatched row is **quarantined (hidden), never guessed**.

Concretely:

- `ai_models` carries `native_model_id`, `id_verified`, `id_verified_at`.
- `ResolvedModel` carries two fields, and confusing them is a bug in either direction:
  **`model`** is the catalog key — what a picker displays, what a pin stores, what the usage ledger
  records. **`requestModel`** is the wire id (`nativeModelId ?? modelId`) — the only value an
  adapter may receive.
- Verification runs when a key is saved, and at refresh for the platform Anthropic key.
- It **fails closed**: a transport error, an unparseable payload or an empty list skips that
  provider entirely and touches no row, and a previously-verified row is never demoted on one bad
  list call. A provider outage must never empty a picker.
- The pricing floor lookup must normalise too: the catalog id is dotted while `FALLBACK_RATES` is
  hyphenated, so it tries catalog id → dots-to-hyphens → native id → native minus a trailing
  `-\d{8}`. Missing this meant the floor protected only the models whose ids happened to have no
  dot.

## Consequences

- **Three of five providers show an empty picker until a key is saved for them** — a provider's
  model list is only verifiable with that provider's own key. Empty copy must therefore read
  *"add a key to see models"*, never *"no models available"*, which reads as a product fault.
- **Some pins are dated snapshots, not moving aliases.** `claude-haiku-4.5` now resolves to
  `claude-haiku-4-5-20251001`. Deterministic, but it does not auto-upgrade.
- **Only Anthropic re-verifies after a refresh** (it is the one provider with a platform key). For
  the other four, "new models without a deploy" is false until a user re-saves their key. This is
  the largest open gap and belongs in Spec 2.
- The plan gained a second migration for `native_model_id` — the one-migration rule was relaxed
  deliberately, because it guards against parallel worktrees colliding on version stamps and this
  plan ran serially in one worktree.

## The generalisable lesson

**An aggregator's identifiers are its own namespace, not a pass-through of its upstreams'** — and a
partial overlap is worse than none, because the matching cases hide the diverging ones until a
refresh retires something load-bearing. When one system's ids are used to call another, the
receiving system is the only authority on whether an id is real.
