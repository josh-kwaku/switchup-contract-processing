# Issues & Technical Debt

## Known Bugs

*No bugs yet — project is in design phase.*

<!-- Template:
### [BUG-001] Brief description
- **Severity**: Critical / High / Medium / Low
- **Component**: domain / services / infrastructure / workflows
- **Steps to reproduce**:
- **Expected behavior**:
- **Actual behavior**:
- **Notes**:
-->

---

## Technical Debt

### [TD-001] Old Windmill scripts in f/ need rework
- **Priority**: High
- **Component**: workflows
- **Description**: `f/process_contract/` contains self-contained Windmill scripts with duplicated service logic (~250 lines in `lib.ts`). These need to be replaced with thin HTTP callers per the new architecture (ADR-002).
- **Impact**: Blocks Sprint 4 implementation. Old scripts are non-functional under the new design.
- **Suggested fix**: Delete old scripts, implement new thin HTTP callers in Sprint 4 Task 4.3.

### [TD-002] src/workflows/scripts/ and src/workflows/triggers/ are stale
- **Priority**: Medium
- **Component**: workflows
- **Description**: These were canonical Windmill script designs from the old architecture. Under ADR-002, the service owns all logic and Windmill scripts live only in `f/`. These files should be removed in Sprint 4 Task 4.4.
- **Impact**: Confusing to have stale code in the repo.
- **Suggested fix**: Delete in Task 4.4 when deploying the new flow.

<!-- Template:
### [TD-001] Brief description
- **Priority**: High / Medium / Low
- **Component**: domain / services / infrastructure / workflows
- **Description**:
- **Impact**:
- **Suggested fix**:
-->

---

## Future Improvements

### Authentication
- JWT authentication (V2 feature, out of scope for POC)
- Role-based access for reviewers

### Real-Time
- WebSocket/SSE notifications for review tasks
- Real-time workflow status updates

### Batch Processing
- Batch PDF upload UI
- Parallel workflow execution

### A/B Testing
- Prompt A/B testing via Langfuse labels
- Confidence threshold tuning

---

## Notes

Update this file when:
- Discovering new bugs during development
- Identifying technical debt
- Completing fixes (move to "Resolved" section or remove)

### Resolved Issues

*None yet.*
