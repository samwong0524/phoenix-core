---
name: workflow-create-troubleshooting
description: Diagnose and workaround for create_workflow INSERT failures in groups without proper coordinator setup
auto-load: true
metadata:
  roles: [IT主管]
---
## Problem
`create_workflow` fails with SQL INSERT error on `workflows` table for certain groups. The error shows `Failed query: INSERT INTO workflows ...` even with valid parameters.

## Root Cause
The group was likely created without a proper coordinator role, or the `creator_id` validation fails in the backend. Groups created before the workflow system was fully initialized may lack required metadata.

## Workaround
1. **Check group status**: Use `get_workflow_status` — if it returns `workflow: null`, the group may not support workflows.
2. **Try minimal parameters**: Start with simplest task `[{ "name": "test" }]` and `autoActivate: false`.
3. **If still failing**: The group needs to be recreated with proper coordinator setup, or the human needs to re-initialize the workspace.
4. **Alternative**: Use direct `send_group_message` / `send_direct_message` to assign tasks manually without workflow system.

## When to escalate
If create_workflow fails 3+ times on the same group, stop retrying and report to human. The issue is likely at the database/group-metadata level, not parameter-related.