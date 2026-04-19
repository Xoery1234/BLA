/**
 * bla-orchestrator-mcp — workflow state machine coordinating LLM + Adobe MCPs.
 *
 * Spec: docs/mcp/orchestrator-mcp-spec.md
 * PRD:  docs/PRD-BLA-FLYWHEEL-CONNECTORS-v2.md §3.3
 *
 * Sprint 1 ships this stub. Sprint 2 replaces with brief intake,
 * the 11-state machine, Workfront webhook receiver with JCS event
 * signatures per §8.4.1, cost-ledger with SELECT FOR UPDATE per
 * Patch 3.1, and triple-gate live publish orchestration.
 */

import { NotImplementedError } from '@bla/shared';

throw new NotImplementedError(
  'bla-orchestrator-mcp entry point not implemented — see docs/mcp/orchestrator-mcp-spec.md',
);
