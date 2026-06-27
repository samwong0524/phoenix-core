---
name: create-workflow-db-failure
description: Troubleshooting create_workflow database failures
---
## Problem
The `create_workflow` tool fails with `Failed query: INSERT INTO workflows` error. This is a database-level failure, not a parameter issue.

## Diagnosis
1. The tool generates UUIDs correctly
2. Parameters are valid (groupId, name, description, tasks with assigneeRole, etc.)
3. The INSERT query fails at the database layer

## Possible Causes
- Database table `workflows` may not exist or schema is corrupted
- The group may not be properly registered as a workflow-enabled group
- Permission issue with the creator_id on this specific group

## Workaround
1. Try with minimal parameters (simplified name, description, minimal tasks)
2. Try with `autoActivate: false` instead of `true`
3. If all attempts fail, inform the human about the database issue
4. As an alternative, use `send_group_message` to assign tasks manually without the workflow system

## Key Takeaway
When `create_workflow` fails with INSERT errors, it's likely a DB schema issue. Document the pattern and escalate to human.