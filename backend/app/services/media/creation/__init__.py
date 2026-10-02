"""Shared media apply/create functions (batch draft appliers, §1C).

A batch apply function has the shape
``apply_<entity>(session, organization_id, target_id, payload, actor)`` and
applies ``payload`` to ONE target. The factory's batch applier calls it per id
in the draft's ``target_entity_ids`` inside the draft's savepoint (all-or-
nothing). The caller owns the transaction.
"""
