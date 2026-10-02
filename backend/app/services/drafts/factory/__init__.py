"""Declarative write-tool factory for agent drafts (Guide Studio v2 scale-out).

A new draftable entity is *one* ``EntityDraftSpec`` declaration (plus its
payload schema and a shared ``create_<entity>`` function). The factory derives
the ``propose_<entity>_draft`` tool, its JSON-schema params, the apply-time
applier, the payload-schema registry, and each specialist's tool allowlist from
the spec list — so dispatch tables and persona lists never drift from the set of
declared entities.

Import discipline (the package is load-bearing for cycle-avoidance):

- ``registry`` imports only the payload schema classes (a *lower* layer than
  services). It is safe to import from ``agent_persona`` and from
  ``schemas`` consumers without re-entrancy.
- ``generator`` / ``wiring`` import ``draft_service`` and the tool registry and
  are therefore only imported lazily, at tool-registration time and inside
  ``draft_service``'s cached dispatch/schema accessors.
- ``factory/__init__`` (this file) imports nothing — importing
  ``factory.registry`` must not pull in ``generator``/``wiring``.
"""
