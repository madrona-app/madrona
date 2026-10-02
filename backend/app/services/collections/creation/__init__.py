"""Shared entity-create functions.

Each ``create_<entity>(session, organization_id, payload, actor, *,
open_approval=True, proposed_by=None) -> Model`` is the single create path used
by BOTH the API router (a thin adapter that commits) and the draft applier
(which runs it inside the draft's savepoint). The contract:

- NEVER commit or rollback — the caller owns the transaction.
- ``flush`` so the returned model has its primary key.
- ``open_approval=False`` from the applier (the draft already gated; avoid
  double-gating). ``proposed_by`` distinguishes the original proposer from the
  approving actor where the model records both.
"""
