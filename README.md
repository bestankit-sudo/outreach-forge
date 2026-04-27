# outreach-forge

Opinionated B2B contact enrichment pipeline.

Find decision-makers at target companies using Apollo, Brave Search, an LLM of your choice, and Notion as the destination. Designed for outreach workflows where precision and cost control matter.

> **Status:** pre-v0.1, under active development. API will change. Not yet published to npm.

## What it does

Given a list of companies (or websites), the pipeline:

1. Resolves company identity (domain, industry, size, funding) via Apollo + website scraping
2. Discovers candidate contacts via Apollo people search + Brave SERP fallback
3. Validates each candidate with an LLM ("does this person actually work at this company?")
4. Scores, dedupes, and merges results across multiple discovery sources
5. Writes structured enrichment data to opinionated Notion databases (Companies, People, Extractions audit log)

## Stack

- **Apollo** — company + people data
- **Brave Search** — LinkedIn discovery + domain disambiguation
- **OpenAI-compatible LLM** — bring your own (OpenAI, Anthropic via OpenAI-compat, Groq, Ollama, etc.)
- **Notion** — destination for enriched data + audit log

## Status of this repo

- [x] Phase A: scaffold + utils ported (logger, rate-limiter, url, name-parser)
- [x] Phase B: API clients (Apollo, Brave, scraper, LLM wrapper)
- [x] Phase C: AI gates parameterized (8 gates with `RoleContext` parameter)
- [x] Phase D: Dedup core (scoring, grouping, planMerge, dedupByKey)
- [ ] Phase E: Notion helpers + standard schema
- [ ] Phase F: Pipeline orchestrator
- [ ] v0.1: Podsque beans shipped on this library

## License

MIT
