"""Multi-agent orchestration tools.

The staff agent calls `delegate_to_specialist` to hand off a focused
question to one of the specialist personas (registrar, loans_registrar,
conservator, rights_specialist, curator). The specialist runs a buffered,
bounded tool loop with its own narrow tool allowlist, and returns a single
final answer plus a brief tool-call trace.

Specialists never delegate further — the recursion guard is enforced both
by PersonaPolicy.can_delegate (data) and by this tool refusing to register
on non-delegating personas.
"""

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from app.config import get_settings
from app.services.agent_persona import (
    SPECIALIST_PERSONAS,
    get_persona_policy,
)
from app.services.agent_tools import AgentContext, ToolRegistry
from app.services.prompt_service import get_system_prompt

logger = logging.getLogger(__name__)

# Hard caps. Specialists are one-shot; they should not loop indefinitely.
MAX_SPECIALIST_TOOL_ROUNDS = 3
MAX_SPECIALIST_QUESTION_LENGTH = 4000


@dataclass
class _SpecialistTrace:
    """One entry per tool call the specialist made."""
    tool: str
    arguments: dict
    succeeded: bool
    duration_ms: int
    error: str | None = None


@dataclass
class _SpecialistRun:
    """Outcome of a single specialist invocation."""
    specialist: str
    answer: str
    rounds_used: int
    trace: list[_SpecialistTrace] = field(default_factory=list)
    error: str | None = None
    aborted: bool = False
    # Token usage accumulated across the specialist's LLM rounds (§2A
    # telemetry). 0 when the provider doesn't report usage — never fabricated.
    input_tokens: int = 0
    output_tokens: int = 0


def _run_specialist(
    specialist: str,
    question: str,
    ctx: AgentContext,
) -> _SpecialistRun:
    """Execute a buffered specialist loop. Returns the final answer + trace."""
    settings = get_settings()
    # Specialists route like staff-side personas; an org can pin a specific
    # profile per specialist via config["llm_profiles"][specialist].
    from app.services.model_profiles import resolve_llm
    bound = resolve_llm(specialist, ctx.organization_id, ctx.db_session, settings)
    llm = bound.client
    model = bound.profile.model

    system_prompt = get_system_prompt(ctx.db_session, ctx.organization_id, specialist)

    if ctx.page_context:
        # Forward staff agent's per-turn page context so the specialist can
        # answer "what does the user see right now?" without re-asking.
        try:
            page_blob = json.dumps(ctx.page_context, default=str)
            system_prompt = (
                f"{system_prompt}\n\n"
                f"PAGE CONTEXT (the user is currently viewing):\n{page_blob}"
            )
        except (TypeError, ValueError):
            logger.debug("Could not serialize page_context for specialist", exc_info=True)

    messages: list[dict] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": question},
    ]

    registry = _get_registry_for_specialist()
    tools = registry.get_tools_for_persona(specialist)

    # Build a specialist-scoped context. Same org/user/db, different persona —
    # so registry.execute() applies the specialist's tool allowlist.
    specialist_ctx = AgentContext(
        organization_id=ctx.organization_id,
        user_id=ctx.user_id,
        persona=specialist,
        db_session=ctx.db_session,
        org_slug=ctx.org_slug,
        context_entity_type=ctx.context_entity_type,
        context_entity_id=ctx.context_entity_id,
        page_context=ctx.page_context,
    )

    trace: list[_SpecialistTrace] = []
    final_answer = ""
    rounds_used = 0
    aborted = False
    input_tokens = 0
    output_tokens = 0

    for round_num in range(1, MAX_SPECIALIST_TOOL_ROUNDS + 1):
        rounds_used = round_num
        try:
            response = llm.chat(
                model,
                messages,
                tools if round_num < MAX_SPECIALIST_TOOL_ROUNDS else None,
                getattr(settings, "agent_num_ctx", 32768),
            )
        except Exception as e:  # noqa: BLE001
            logger.exception("Specialist LLM call failed: %s", specialist)
            return _SpecialistRun(
                specialist=specialist,
                answer="",
                rounds_used=round_num,
                trace=trace,
                error=f"llm_error: {e}",
                aborted=True,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )

        # §2A: accumulate provider-reported token usage across rounds.
        input_tokens += getattr(response, "input_tokens", 0) or 0
        output_tokens += getattr(response, "output_tokens", 0) or 0

        if not response.tool_calls:
            final_answer = response.content or ""
            break

        # Persist the assistant turn (with tool calls) to the in-memory loop
        messages.append({
            "role": "assistant",
            "content": response.content or "",
            "tool_calls": response.tool_calls,
        })

        for call in response.tool_calls:
            fn = call.get("function") or {}
            name = fn.get("name", "")
            raw_args = fn.get("arguments") or {}
            if isinstance(raw_args, str):
                try:
                    args = json.loads(raw_args)
                except json.JSONDecodeError:
                    args = {}
            else:
                args = raw_args

            t0 = time.monotonic()
            exec_result = registry.execute(name, args, specialist_ctx)
            duration_ms = int((time.monotonic() - t0) * 1000)

            result_payload = exec_result.result_for_prompt
            tool_error = (
                result_payload.get("error")
                if isinstance(result_payload, dict) else None
            )
            trace.append(_SpecialistTrace(
                tool=name,
                arguments=args,
                succeeded=tool_error is None,
                duration_ms=duration_ms,
                error=tool_error,
            ))

            messages.append({
                "role": "tool",
                "tool_call_id": call.get("id", ""),
                "content": json.dumps(result_payload, default=str),
            })
    else:
        aborted = True
        final_answer = (
            "(specialist could not produce an answer within the round budget; "
            "the staff agent should reframe the question or try a different specialist)"
        )

    return _SpecialistRun(
        specialist=specialist,
        answer=final_answer.strip(),
        rounds_used=rounds_used,
        trace=trace,
        aborted=aborted,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


def _get_registry_for_specialist() -> ToolRegistry:
    """Local import indirection so tests can patch the registry easily."""
    from app.services.agent_tools import get_tool_registry
    return get_tool_registry()


def delegate_to_specialist(arguments: dict, context: AgentContext) -> dict:
    """Tool handler. The staff agent invokes this to hand a focused question
    to a specialist persona.
    """
    caller_policy = get_persona_policy(context.persona)
    if not caller_policy.can_delegate:
        return {
            "error": (
                f"Persona '{context.persona}' is not allowed to delegate. "
                "Specialists must answer directly without further delegation."
            ),
        }

    specialist = arguments.get("specialist")
    question = arguments.get("question") or ""

    if not isinstance(specialist, str) or specialist not in SPECIALIST_PERSONAS:
        return {
            "error": (
                "specialist must be one of "
                + ", ".join(SPECIALIST_PERSONAS)
                + f"; got {specialist!r}"
            ),
        }

    if not question.strip():
        return {"error": "question is required and must be non-empty"}

    if len(question) > MAX_SPECIALIST_QUESTION_LENGTH:
        return {
            "error": (
                f"question exceeds {MAX_SPECIALIST_QUESTION_LENGTH} characters; "
                "trim it to the focused ask"
            ),
        }

    run = _run_specialist(specialist, question, context)

    payload: dict[str, Any] = {
        "specialist": run.specialist,
        "answer": run.answer,
        "rounds_used": run.rounds_used,
        # §2A telemetry — the executor reads these off the step result to write
        # a per-step metric row.
        "_telemetry": {
            "llm_rounds": run.rounds_used,
            "tool_calls": len(run.trace),
            "input_tokens": run.input_tokens,
            "output_tokens": run.output_tokens,
            "delegation_depth": 1,
        },
        "tool_calls": [
            {
                "tool": t.tool,
                "succeeded": t.succeeded,
                "duration_ms": t.duration_ms,
                **({"error": t.error} if t.error else {}),
            }
            for t in run.trace
        ],
    }
    if run.aborted:
        payload["aborted"] = True
    if run.error:
        payload["error"] = run.error

    return payload


_TOOL_DESCRIPTION = (
    "Hand off a focused, single-step question to a specialist persona that "
    "has narrower tools and deeper expertise than you. Use this for "
    "questions clearly inside a specialist's domain rather than answering "
    "broadly yourself.\n\n"
    "WHO TO PICK:\n"
    "- registrar — cataloging, classifications, materials, vocabulary terms, "
    "procedure cataloging standards.\n"
    "- loans_registrar — loans in/out, transactions, transit, shipments, "
    "facility reports, indemnity terms.\n"
    "- conservator — condition reports, treatment history (never recommends "
    "treatment), environmental requirements, conservation standards.\n"
    "- rights_specialist — copyright, reproductions, donor restrictions, "
    "licensing terms.\n"
    "- curator — interpretation, art-historical context, exhibition object "
    "selection, attribution research.\n\n"
    "RULES:\n"
    "- Send a focused, self-contained question. The specialist does not see "
    "your conversation history — restate any context they need.\n"
    "- One delegation per turn. Don't fan out to multiple specialists in a "
    "single response.\n"
    "- The specialist returns a final answer plus a brief tool-call trace. "
    "Reframe their answer for the user; cite which specialist contributed."
)


_MAKE_PLAN_DESCRIPTION = (
    "Decompose a multi-step user goal into a transparent, executable plan. "
    "Use this when the user asks for something that requires more than one "
    "tool call or specialist call to satisfy — receiving an incoming loan, "
    "running a deaccession review, walking a conservation workflow.\n\n"
    "WHEN TO USE:\n"
    "- The goal is multi-step AND mentions a workflow, procedure, or sequence "
    "  ('walk me through', 'help me run X', 'I'm starting Y').\n"
    "- The goal needs research from multiple sources before action.\n"
    "- The goal will pause on user approval or form submissions.\n\n"
    "WHEN NOT TO USE:\n"
    "- The user asked a single question (just answer it).\n"
    "- The user asked to look up one thing (use the relevant tool directly).\n"
    "- A specialist can answer in one delegation (use delegate_to_specialist).\n\n"
    "RULES:\n"
    "- One make_plan call per user turn. Don't fan out.\n"
    "- The returned plan_id refers to a persisted plan with ordered steps. "
    "  After receiving it, summarize the plan to the user and confirm before "
    "  the executor walks it (executor lands in Phase 2.2).\n"
    "- The planner does NOT execute steps; it only decomposes. Each step is "
    "  recorded in agent_plan_steps with status='pending' for the executor "
    "  to pick up later."
)


def make_plan(arguments: dict, context: AgentContext) -> dict:
    """Tool handler. Invokes the planner persona and persists the plan."""
    caller_policy = get_persona_policy(context.persona)
    if not caller_policy.can_delegate:
        # make_plan is treated as a delegating action — only the staff
        # generalist may invoke it. Specialists must answer or defer.
        return {
            "error": (
                f"Persona '{context.persona}' is not allowed to create plans. "
                "Specialists answer focused questions and do not orchestrate."
            ),
        }

    goal = arguments.get("goal")
    if not isinstance(goal, str) or not goal.strip():
        return {"error": "goal is required and must be a non-empty string"}

    if context.db_session is None:
        return {
            "error": (
                "make_plan requires a live DB session in AgentContext; "
                "got None"
            ),
        }

    # Resolve the live conversation. It comes from the AgentContext (the active
    # conversation the chat is already running in) — the model must never be
    # asked for an internal UUID. An explicit arg is still accepted as an
    # override, mainly for tests.
    from uuid import UUID
    conversation_id_raw = (
        arguments.get("conversation_id")
        or getattr(context, "conversation_id", None)
    )
    if conversation_id_raw is None:
        return {
            "error": (
                "conversation_id is required so the plan can be linked to "
                "the active conversation"
            ),
        }
    try:
        conversation_id = UUID(str(conversation_id_raw))
    except (ValueError, TypeError):
        return {"error": f"conversation_id is not a valid UUID: {conversation_id_raw!r}"}

    from app.models import Conversation
    conversation = (
        context.db_session.query(Conversation)
        .filter(Conversation.conversation_id == conversation_id)
        .first()
    )
    if conversation is None:
        return {"error": f"conversation {conversation_id} not found"}
    if conversation.organization_id != context.organization_id:
        return {"error": "conversation belongs to a different organization"}

    parent_message_id_raw = arguments.get("parent_message_id")
    parent_message_id = None
    if parent_message_id_raw:
        try:
            parent_message_id = UUID(str(parent_message_id_raw))
        except (ValueError, TypeError):
            return {
                "error": f"parent_message_id is not a valid UUID: {parent_message_id_raw!r}",
            }

    # §1E: an optional template_id instantiates a canonical plan deterministically
    # (e.g. a per-workspace AskGuideButton wired to a specific procedure).
    template_id = arguments.get("template_id") or None
    template_params = arguments.get("template_params")
    if template_params is not None and not isinstance(template_params, dict):
        return {"error": "template_params must be an object"}

    from app.services.agent_plan_service import PlanService
    service = PlanService(context.db_session, context)
    result = service.create_plan(
        goal=goal,
        conversation=conversation,
        parent_message_id=parent_message_id,
        template_id=template_id,
        template_params=template_params,
    )

    if result.error is not None:
        return {
            "error": result.error,
            "error_kind": result.error_kind,
        }

    plan = result.plan
    steps_payload = [
        {
            "step_id": str(step.step_id),
            "idx": step.idx,
            "kind": step.kind,
            "description": step.description,
            "tool": step.tool,
            "persona": step.persona,
            "status": step.status,
            # wait_for lets the UI pick the right await action (approval link
            # vs "mark form submitted"). Only set on await steps.
            "wait_for": step.wait_for,
        }
        for step in result.steps
    ]
    return {
        "plan_id": str(plan.plan_id),
        "goal": plan.goal,
        "status": plan.status,
        "step_count": len(result.steps),
        "steps_preview": steps_payload,
        # Lifted into the SSE tool_end event by agent_service.stream_response;
        # the chat UI renders a plan checklist inline alongside the staff reply.
        "_ui": {
            "kind": "plan",
            "plan_id": str(plan.plan_id),
            "goal": plan.goal,
            "status": plan.status,
            "steps": steps_payload,
        },
    }


def register_orchestration_tools(registry: ToolRegistry) -> None:
    """Register multi-agent orchestration tools.

    Only registers delegating tools for personas whose
    PersonaPolicy.can_delegate is True. Specialists never see these tools.
    """
    delegating_personas = [
        p.name
        for p in (
            get_persona_policy("staff"),
        )
        if p.can_delegate
    ]
    if not delegating_personas:
        return

    registry.register(
        name="delegate_to_specialist",
        description=_TOOL_DESCRIPTION,
        parameters={
            "type": "object",
            "properties": {
                "specialist": {
                    "type": "string",
                    "description": "Which specialist to hand off to.",
                    "enum": list(SPECIALIST_PERSONAS),
                },
                "question": {
                    "type": "string",
                    "description": (
                        "A focused, self-contained question for the specialist. "
                        "Include any context they need; they don't see the "
                        "rest of the conversation."
                    ),
                },
            },
            "required": ["specialist", "question"],
        },
        handler=delegate_to_specialist,
        personas=delegating_personas,
    )

    registry.register(
        name="make_plan",
        description=_MAKE_PLAN_DESCRIPTION,
        parameters={
            "type": "object",
            "properties": {
                "goal": {
                    "type": "string",
                    "description": (
                        "The user's multi-step goal in plain English. "
                        "The planner restates and decomposes it."
                    ),
                },
                "conversation_id": {
                    "type": "string",
                    "description": (
                        "Optional — defaults to the active conversation, which "
                        "the system supplies. Never ask the user for this; leave "
                        "it out and the current conversation is used."
                    ),
                },
                "parent_message_id": {
                    "type": "string",
                    "description": (
                        "Optional UUID of the assistant message that triggered "
                        "the plan. Lets the chat UI render the plan card "
                        "alongside the right turn."
                    ),
                },
                "template_id": {
                    "type": "string",
                    "description": (
                        "Optional id of a canonical plan template to instantiate "
                        "deterministically (e.g. 'loan_in_reception', "
                        "'acquisition_accession') instead of free-form planning. "
                        "Use when the goal clearly matches a standard procedure."
                    ),
                },
                "template_params": {
                    "type": "object",
                    "description": (
                        "Optional parameters for the template (e.g. "
                        "acquisition_method, lender_name). object_id is taken "
                        "from the current page when available."
                    ),
                },
            },
            "required": ["goal"],
        },
        handler=make_plan,
        personas=delegating_personas,
    )
