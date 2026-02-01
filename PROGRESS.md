# Project Progress

## Overview

SwitchUp Contract Processing System — portfolio demo for Senior Fullstack Engineer application.

**Timeline**: 6-8 hours using Claude Code
**Current Phase**: Sprint 4 Complete (Tasks 4.1–4.3)

---

## Design Phase (Complete)

- [x] PRD with functional requirements (FR1-FR6)
- [x] Technical design document (architecture, schema, state machine, error handling)
- [x] Database schema design (7 tables: verticals, providers, provider_configs, workflows, contracts, review_tasks, workflow_state_log)
- [x] Workflow state machine (10 fine-grained states)
- [x] Error handling strategy (per-step error codes, Result types, retry policy)
- [x] Code guidelines (adapted from Releve standards)
- [x] Error handling guidelines
- [x] Code review subagent
- [x] Session management workflow (CLAUDE.md, SESSION.md, ISSUES.md, PROGRESS.md)
- [x] ADR decisions directory
- [x] Sprint plan (7 sprints, 30 tasks, Drizzle ORM)

---

## Implementation Phase

### Sprint 1: Foundation — Scaffolding, Domain Types, Database
- [x] Task 1.1: Initialize TypeScript project + external accounts
- [x] Task 1.2: Create domain types + logger
- [x] Task 1.3: Create Drizzle schema definitions
- [x] Task 1.4: Create database infrastructure + Drizzle config
- [x] Task 1.5: Create migration runner + seed script
- [x] Task 1.6: Create provider registry service

### Sprint 2: PDF Parsing + LLM Extraction Pipeline
- [x] Task 2.1: Create PDF parser infrastructure module
- [x] Task 2.2: Create Langfuse infrastructure module
- [x] Task 2.3: Set up Langfuse account and create prompts
- [x] Task 2.4: Create LLM provider infrastructure — Groq adapter
- [x] Task 2.5: Create extraction service
- [x] Task 2.6: Create confidence scoring module
- [x] Task 2.7: Create end-to-end extraction script

### Sprint 3: Core Services — Workflow State Machine, Validation, Contracts
- [x] Task 3.1: Create PDF storage module
- [x] Task 3.2: Create workflow state transition service
- [x] Task 3.3: Create contract and review task services
- [x] Task 3.4: Create validation service

### Sprint 4: Windmill Integration — Flow, Scripts, Webhook
- [x] Task 4.1: Set up Windmill local environment + resources
- [x] Task 4.2: Create Windmill flow scripts
- [x] Task 4.3: Wire Windmill flow + webhook trigger

### Sprint 5: Human-in-the-Loop Review
- [ ] Task 5.1: Implement Windmill suspend/resume for review
- [ ] Task 5.2: Implement review correction flow
- [ ] Task 5.3: Implement review timeout

### Sprint 6: Error Handling, Retry Logic, Resilience
- [ ] Task 6.1: Implement retry logic in Windmill flow
- [ ] Task 6.2: Verify Langfuse cache fallback end-to-end
- [ ] Task 6.3: Add comprehensive structured logging

### Sprint 7: Demo Preparation — Test Data, Scripts, README
- [ ] Task 7.1: Create synthetic German contract PDFs
- [ ] Task 7.2: Create end-to-end demo script
- [ ] Task 7.3: Write README
- [ ] Task 7.4: Create GitHub repository and push

---

## Success Criteria

Demo succeeds when:
1. [ ] Single codebase processes Energy, Telco, Insurance contracts
2. [ ] Update prompt in Langfuse UI → next run uses new version
3. [ ] Low confidence (<80%) automatically triggers human review
4. [ ] Failed workflows retry at the specific failed step
5. [ ] Unknown providers route to human review
6. [ ] Clean, documented, interview-ready code
7. [ ] Synthetic German PDF contracts for demo
8. [ ] Mock tariff comparison step shows extensibility
9. [ ] README ready

---

## Notes

- This is a POC/demo, not production software
- Focus on core functionality, skip nice-to-haves
- Code quality > feature quantity
- Drizzle ORM for all DB operations (no raw SQL)
- Demo video is a manual task, not tracked here
