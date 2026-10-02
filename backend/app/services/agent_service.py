"""
Core agent service — LLM chat with streaming tool loop.

Supports Ollama (local) and RunPod serverless (vLLM) backends via llm_client.

Architecture:
  User message -> load history -> LLM chat (stream)
  -> tool_calls? Execute, append, call LLM again (max N rounds)
  -> content? Stream SSE deltas to client
  -> Persist messages to DB
"""

import json
import logging
import re
from typing import Any, Generator
from uuid import UUID

from sqlalchemy import text

import requests

# Pattern to extract object numbers from text (for retry fallback)
_OBJECT_NUMBER_EXTRACT_RE = re.compile(r'\b(\d{4}\.\d+(?:\.\d+)*)\b|\b([A-Z]{1,4}[-.]\d{3,})\b')

from app.config import get_settings
from app.services.llm_client import get_llm_client
from app.services.rls import set_rls_context_for_session
from app.models.agent import Conversation, Message
from app.services.agent_persona import get_persona_policy
from app.services.agent_tools import (
    AgentContext,
    TOOL_RESULT_PREFIX,
    TOOL_RESULT_SUFFIX,
    _INJECTION_PATTERNS,
    get_tool_registry,
)
from app.services.agent_tools.system_prompts import STAFF_SYSTEM_PROMPT, VISITOR_SYSTEM_PROMPT, GUIDE_SYSTEM_PROMPT
from app.services.prompt_service import (
    get_system_prompt as get_db_system_prompt,
    get_user_preferences,
)
from app.services.agent_guardrails import get_guardrail_service
from app.services.agent_monitoring import RequestTracker
from app.services.agent_retention import extract_pii, scrub_pii, scrub_echoed_pii

logger = logging.getLogger(__name__)

SYSTEM_PROMPTS = {
    "staff": STAFF_SYSTEM_PROMPT,
    "visitor": VISITOR_SYSTEM_PROMPT,
    "guide": GUIDE_SYSTEM_PROMPT,
}


class AgentService:
    """Orchestrates the agent conversation loop."""

    def __init__(self, session):
        self.settings = get_settings()
        self.registry = get_tool_registry()
        self.session = session
        # Fallback client; stream_response re-binds per (persona, org) via
        # model_profiles.resolve_llm before any LLM call — unless a caller
        # (tests, callers with a pre-built client) injected its own by
        # assigning self.llm, which routing must respect.
        self.llm = get_llm_client(self.settings)
        self._default_llm = self.llm
        self._active_model = self.settings.agent_model

    def create_conversation(
        self,
        organization_id: UUID,
        persona: str,
        user_id: UUID | None = None,
        session_id: str | None = None,
        context_entity_type: str | None = None,
        context_entity_id: UUID | None = None,
        visitor_id: UUID | None = None,
        visit_id: UUID | None = None,
    ) -> Conversation:
        # Auto-set title from entity context
        title = None
        if context_entity_type == 'collection_object' and context_entity_id:
            from app.models import CollectionObject
            obj = self.session.query(
                CollectionObject.object_number, CollectionObject.object_name,
            ).filter(
                CollectionObject.object_id == context_entity_id,
                CollectionObject.organization_id == organization_id,
            ).first()
            if obj:
                title = obj.object_number
                if obj.object_name:
                    title += f" — {obj.object_name[:80]}"
        elif context_entity_type and context_entity_id:
            from app.services.agent_tools.form_registry import FORM_REGISTRY, get_entity_model_map
            entity_model_map = get_entity_model_map()
            if context_entity_type in entity_model_map:
                model_cls, pk_field, number_field = entity_model_map[context_entity_type]
                entity = self.session.query(model_cls).filter(
                    getattr(model_cls, pk_field) == context_entity_id,
                    model_cls.organization_id == organization_id,
                ).first()
                if entity:
                    form_def = FORM_REGISTRY.get(context_entity_type)
                    identifier = (
                        getattr(entity, number_field, None) if number_field else None
                    ) or str(context_entity_id)
                    if form_def:
                        title = f"{form_def.entity_label}: {identifier}"
                    else:
                        title = identifier

        conv = Conversation(
            organization_id=organization_id,
            persona=persona,
            user_id=user_id,
            session_id=session_id,
            context_entity_type=context_entity_type,
            context_entity_id=context_entity_id,
            title=title,
            visitor_id=visitor_id,
            visit_id=visit_id,
            # Phase 3: seed persona_history with the creation-time persona so
            # subsequent router/manual switches have a baseline to append to.
            persona_history=[{
                "persona": persona,
                "source": "initial",
            }],
        )
        self.session.add(conv)
        self.session.commit()
        return conv

    def get_conversation(
        self,
        conversation_id: UUID,
        organization_id: UUID,
        user_id: UUID | None = None,
        session_id: str | None = None,
    ) -> Conversation | None:
        query = self.session.query(Conversation).filter(
            Conversation.conversation_id == conversation_id,
            Conversation.organization_id == organization_id,
        )
        if user_id:
            query = query.filter(Conversation.user_id == user_id)
        if session_id:
            query = query.filter(Conversation.session_id == session_id)
        return query.first()

    def list_conversations(
        self,
        organization_id: UUID,
        user_id: UUID,
        limit: int = 50,
    ) -> list[Conversation]:
        return (
            self.session.query(Conversation)
            .filter(
                Conversation.organization_id == organization_id,
                Conversation.user_id == user_id,
            )
            .order_by(Conversation.updated_at.desc())
            .limit(limit)
            .all()
        )

    def get_messages(
        self,
        conversation_id: UUID,
        organization_id: UUID,
    ) -> list[Message]:
        return (
            self.session.query(Message)
            .filter(
                Message.conversation_id == conversation_id,
                Message.organization_id == organization_id,
            )
            .order_by(Message.created_at.asc())
            .all()
        )

    def delete_conversation(
        self,
        conversation_id: UUID,
        organization_id: UUID,
        user_id: UUID,
    ) -> bool:
        conv = self.session.query(Conversation).filter(
            Conversation.conversation_id == conversation_id,
            Conversation.organization_id == organization_id,
            Conversation.user_id == user_id,
        ).first()
        if not conv:
            return False
        self.session.delete(conv)
        self.session.commit()
        return True

    def stream_response(
        self,
        conversation: Conversation,
        user_message: str,
        locale: str | None = None,
        page_context: dict | None = None,
        input_mode: str | None = None,
    ) -> Generator[str, None, None]:
        """
        Generator that yields SSE-formatted events.

        Runs the Ollama tool loop: send messages -> handle tool_calls -> repeat
        until the model produces a text response or max rounds are hit.

        Visitor persona: mandatory buffering (zero text_delta before guardrails).
        Staff persona: token-by-token streaming (advisory guardrails), unless
        AGENT_STAFF_BUFFERED=true.

        page_context is a per-turn snapshot of the user's current UI state
        (route, entity, workflow, edit mode). It is not persisted on the
        conversation — just injected into the system prompt for this turn so
        the model can answer "what do I need to do next?" without the user
        re-explaining where they are.
        """
        organization_id = conversation.organization_id

        # Phase 3 router: on the first staff message, classify the user's
        # input and possibly switch persona to a specialist. Visitor and
        # guide bypass — those are explicit product surfaces, not routed.
        if conversation.persona == "staff":
            self._maybe_route_first_message(
                conversation, user_message, page_context,
            )

        persona = conversation.persona
        policy = get_persona_policy(persona)

        # Per-(persona, org) model routing — with no profile configuration
        # this resolves to the same client/model as the global settings.
        # Skipped when a caller injected its own client (self.llm reassigned).
        if self.llm is self._default_llm:
            from app.services.model_profiles import resolve_llm
            bound = resolve_llm(persona, organization_id, self.session, self.settings)
            self.llm = bound.client
            self._default_llm = bound.client
            self._active_model = bound.profile.model
            model_provider = bound.profile.provider
        else:
            model_provider = self.settings.agent_provider
        model = self._active_model
        max_rounds = self.settings.agent_max_tool_rounds
        buffered = (persona == "visitor") or self.settings.agent_staff_buffered

        # --- Initialize request monitoring ---
        tracker = RequestTracker(
            organization_id=str(organization_id),
            persona=persona,
            model_provider=model_provider,
            user_id=str(conversation.user_id) if conversation.user_id else None,
            conversation_id=str(conversation.conversation_id),
        )

        # PII handling for visitors: scrub storage, track for outbound
        visitor_pii: set[str] = set()
        storage_content = user_message
        if persona == "visitor":
            visitor_pii = extract_pii(user_message)
            storage_content = scrub_pii(user_message)

        # Persist user message (scrubbed for visitors)
        user_msg = Message(
            conversation_id=conversation.conversation_id,
            organization_id=organization_id,
            role="user",
            content=storage_content,
        )
        self.session.add(user_msg)
        self._commit_persisting_rls(organization_id, conversation.user_id)

        # Record question and page context for telemetry
        tracker.record_question(user_message)
        tracker.record_page_context(page_context)

        # Build message history for Ollama
        ollama_messages, context_text = self._build_ollama_messages(
            conversation, persona, policy=policy, locale=locale, input_mode=input_mode,
            page_context=page_context,
        )

        # Prior assistant replies (already guardrail-approved when emitted) —
        # grounding corpus so follow-ups like "give me that link again" pass.
        prior_assistant_text = "\n".join(
            m.get("content", "")
            for m in ollama_messages
            if m.get("role") == "assistant" and m.get("content")
        )

        # Get tools for persona
        tools = self.registry.get_tools_for_persona(persona)

        # Context for tool execution
        from app.models import Organization
        org = self.session.query(Organization.slug).filter(
            Organization.organization_id == organization_id,
        ).first()
        ctx = AgentContext(
            organization_id=organization_id,
            user_id=conversation.user_id,
            persona=persona,
            db_session=self.session,
            org_slug=org.slug if org else None,
            conversation_id=conversation.conversation_id,
            context_entity_type=conversation.context_entity_type,
            context_entity_id=conversation.context_entity_id,
            page_context=page_context,
        )

        # --- Pre-check user input (visitor policy gates) ---
        guardrail_service = get_guardrail_service()
        pre_check = guardrail_service.check_user_input(user_message, persona)
        if pre_check is not None and pre_check.blocked:
            # Short-circuit: skip Ollama entirely
            tracker.record_guardrail()
            tracker.record_deferral()
            assistant_content = pre_check.replacement or ""
            assistant_msg = Message(
                conversation_id=conversation.conversation_id,
                organization_id=organization_id,
                role="assistant",
                content=assistant_content,
                model=model,
                meta={
                    "guardrails": {
                        "passed": False,
                        "blocked": True,
                        "retried": False,
                        "retry_tool": None,
                        "warnings": pre_check.warnings,
                    },
                    "tool_injection_stripped": 0,
                },
            )
            self.session.add(assistant_msg)
            self._commit_persisting_rls(organization_id, conversation.user_id)
            if buffered:
                yield self._sse("text_delta", {"text": assistant_content})
            yield self._sse("done", {"message_id": str(assistant_msg.message_id)})
            tracker.finish(self.session)
            return

        # --- Tool loop ---
        assistant_content = ""
        tool_round = 0
        all_tool_results = []  # Collect raw results for guardrail checks
        # UI hints accumulated from tool results this turn. Persisted onto
        # the assistant message's meta so refresh/history replays can
        # rehydrate the "Go there →" buttons.
        turn_ui_hints: list[dict] = []

        try:
            while tool_round < max_rounds:
                tool_round += 1
                tracker.record_llm_round()

                try:
                    stream = self.llm.chat_stream(
                        model,
                        ollama_messages,
                        tools if tool_round <= max_rounds else [],
                        self.settings.agent_num_ctx,
                    )
                except requests.RequestException as e:
                    logger.error("LLM request failed: %s", e)
                    tracker.record_error(str(e), error_type="llm_connection")
                    tracker.finish(self.session)
                    yield self._sse("error", {"error": "AI service unavailable"})
                    return

                # Process streamed chunks
                accumulated_content = ""
                accumulated_tool_calls = []
                # Buffer text per round so we can suppress pre-tool
                # narration ("Let me check...") if tool calls follow.
                # Only the final round (no tool calls) gets streamed.
                round_text_buffer: list[str] = []

                try:
                    for chunk in stream:
                        if chunk.content:
                            accumulated_content += chunk.content
                            round_text_buffer.append(chunk.content)
                            tracker.record_first_token()

                        if chunk.tool_calls:
                            accumulated_tool_calls.extend(chunk.tool_calls)

                        if chunk.done:
                            if chunk.input_tokens or chunk.output_tokens:
                                tracker.record_tokens(chunk.input_tokens, chunk.output_tokens)
                            break
                except requests.RequestException as e:
                    logger.error("LLM streaming failed: %s", e)
                    tracker.record_error(str(e), error_type="llm_streaming")
                    tracker.finish(self.session)
                    yield self._sse("error", {"error": "AI service unavailable"})
                    return

                # If we got tool calls, execute them and loop
                if accumulated_tool_calls:
                    ollama_messages.append({
                        "role": "assistant",
                        "content": accumulated_content or "",
                        "tool_calls": accumulated_tool_calls,
                    })

                    for tc in accumulated_tool_calls:
                        func = tc.get("function", {})
                        tool_name = func.get("name", "")
                        tool_args = func.get("arguments", {})

                        # Tool events always stream (even in buffered mode).
                        # For delegate_to_specialist, surface the chosen
                        # specialist so the UI can show "Asking the registrar…"
                        # instead of a generic "working" indicator.
                        tool_start_payload: dict[str, Any] = {"tool": tool_name}
                        if tool_name == "delegate_to_specialist":
                            specialist_arg = (
                                tool_args.get("specialist")
                                if isinstance(tool_args, dict) else None
                            )
                            if isinstance(specialist_arg, str):
                                tool_start_payload["specialist"] = specialist_arg
                        yield self._sse("tool_start", tool_start_payload)

                        exec_result = self.registry.execute(
                            tool_name, tool_args, ctx,
                            strip_injections=policy.strip_injection_in_prompt,
                        )
                        all_tool_results.append(exec_result.result_raw)
                        tracker.record_tool_call(tool_name)

                        # Track empty tool results for telemetry — surfaces
                        # retrieval quality issues (playbook/reference miss).
                        if isinstance(exec_result.result_raw, dict):
                            results_list = exec_result.result_raw.get("results")
                            if isinstance(results_list, list) and len(results_list) == 0:
                                tracker.record_empty_tool_result()

                        # Lift any `_ui` hint from the tool result into the
                        # tool_end event so the frontend can render message-
                        # attached UI affordances (e.g. navigate_to buttons).
                        # Also stash it in turn_ui_hints so we can persist
                        # the hint onto the assistant message's meta below
                        # — without this, hints would only survive in React
                        # state and disappear on page refresh.
                        tool_end_payload: dict[str, Any] = {"tool": tool_name}
                        if isinstance(exec_result.result_raw, dict):
                            ui_hint = exec_result.result_raw.get("_ui")
                            if isinstance(ui_hint, dict):
                                tool_end_payload["ui"] = ui_hint
                                turn_ui_hints.append(ui_hint)
                            section_hints = exec_result.result_raw.get("_section_hints")
                            if isinstance(section_hints, list) and section_hints:
                                tool_end_payload["section_hints"] = section_hints

                            # Multi-agent orchestration: when the staff agent
                            # delegated to a specialist, lift the answer +
                            # trace so the chat UI can render an expandable
                            # delegation card alongside the staff reply.
                            if tool_name == "delegate_to_specialist":
                                raw = exec_result.result_raw
                                delegation_payload: dict[str, Any] = {
                                    "specialist": raw.get("specialist"),
                                    "answer": raw.get("answer", ""),
                                    "rounds_used": raw.get("rounds_used", 0),
                                    "tool_calls": raw.get("tool_calls", []),
                                }
                                if raw.get("aborted"):
                                    delegation_payload["aborted"] = True
                                if raw.get("error"):
                                    delegation_payload["error"] = raw["error"]
                                tool_end_payload["delegation"] = delegation_payload
                                turn_ui_hints.append({
                                    "kind": "delegation",
                                    **delegation_payload,
                                })
                        yield self._sse("tool_end", tool_end_payload)

                        prompt_content = json.dumps(exec_result.result_for_prompt, default=str)
                        ollama_messages.append({
                            "role": "tool",
                            "content": f"{TOOL_RESULT_PREFIX}\n{prompt_content}\n{TOOL_RESULT_SUFFIX}",
                        })

                    # Pre-tool narration is suppressed — the buffered
                    # text from this round is discarded. The user sees
                    # the tool indicator instead of "Let me check..."
                    continue

                # No tool calls — this is the final answer. Flush the
                # buffered text as text_delta events.
                if not buffered and round_text_buffer:
                    for text_chunk in round_text_buffer:
                        yield self._sse("text_delta", {"text": text_chunk})
                assistant_content = accumulated_content
                break

        except Exception:
            if buffered:
                # Zero-leak: log only metadata, never raw text
                logger.error(
                    "Agent generation failed: conversation_id=%s content_length=%d "
                    "tool_results_count=%d exception_type=%s",
                    conversation.conversation_id,
                    len(assistant_content),
                    len(all_tool_results),
                    type(Exception).__name__,
                    exc_info=False,
                )
                tracker.record_error("Agent generation failed", error_type="generation")
                tracker.finish(self.session)
                if self.settings.agent_debug_store_partial and assistant_content:
                    self._store_debug_partial(conversation, assistant_content)
                yield self._sse("error", {"error": "An error occurred generating a response"})
                yield self._sse("done", {})
                return
            else:
                tracker.record_error("Agent generation failed", error_type="generation")
                tracker.finish(self.session)
                raise

        # --- Post-generation guardrails and delivery ---
        injection_stripped = sum(
            tr.get("_injection_stripped", 0)
            for tr in all_tool_results
            if isinstance(tr, dict)
        )

        guardrail_service = get_guardrail_service()
        guardrail_result = guardrail_service.check_response(
            assistant_content,
            all_tool_results,
            persona=persona,
            context_text=context_text,
            user_message=user_message,
            prior_assistant_text=prior_assistant_text,
        )

        # Track guardrail outcomes
        if not guardrail_result.passed or guardrail_result.warnings:
            tracker.record_guardrail()
        if guardrail_result.blocked:
            tracker.record_deferral()

        # --- Auto-retry for buffered mode ---
        retried = False
        retry_tool = None
        original_content = None

        if buffered and guardrail_result.blocked and guardrail_result.retryable:
            original_content = assistant_content
            retry_result, retry_tool_name = self._attempt_retry(
                conversation, ctx, policy, ollama_messages, model, user_message,
                all_tool_results, context_text, guardrail_service,
            )
            if retry_result is not None:
                assistant_content = retry_result
                retried = True
                retry_tool = retry_tool_name
                # Re-run guardrails on retried content
                guardrail_result = guardrail_service.check_response(
                    assistant_content,
                    all_tool_results,
                    persona=persona,
                    context_text=context_text,
                    user_message=user_message,
                    prior_assistant_text=prior_assistant_text,
                )

        # Apply replacement if still blocked
        if guardrail_result.blocked and guardrail_result.replacement:
            if original_content is None:
                original_content = assistant_content
            assistant_content = guardrail_result.replacement

        # Build metadata
        guardrail_metadata = self._build_guardrail_metadata(
            guardrail_result, injection_stripped, retried, retry_tool, original_content,
        )
        # Attach any UI hints we lifted from tool results this turn so that
        # page refresh / history replay can rehydrate message-attached
        # affordances (navigate_to / lookup_playbook navigation buttons).
        # _build_guardrail_metadata returns None in the happy-path case
        # (no warnings, no retries) — initialize an empty dict so the
        # hints still land on meta without clobbering the fact that we
        # can save meta-less messages.
        if turn_ui_hints:
            if guardrail_metadata is None:
                guardrail_metadata = {}
            guardrail_metadata["ui_hints"] = turn_ui_hints

        # --- Scrub echoed PII for visitors before delivery ---
        if persona == "visitor" and visitor_pii:
            assistant_content = scrub_echoed_pii(assistant_content, visitor_pii)

        # --- Deliver to client ---
        if buffered:
            # Single text_delta with the final (post-guardrail) content
            if assistant_content:
                yield self._sse("text_delta", {"text": assistant_content})
        # else: already streamed token-by-token above

        # Persist assistant message
        assistant_msg = Message(
            conversation_id=conversation.conversation_id,
            organization_id=organization_id,
            role="assistant",
            content=assistant_content,
            model=model,
            meta=guardrail_metadata,
        )
        self.session.add(assistant_msg)
        self._commit_persisting_rls(organization_id, conversation.user_id)

        yield self._sse("done", {"message_id": str(assistant_msg.message_id)})

        # Persist monitoring metrics (best-effort, idempotent via _finished flag)
        tracker.finish(self.session)

        # Auto-generate conversation title
        if conversation.title is None:
            title = self._generate_title(conversation, user_message)
            if title:
                try:
                    self.session.execute(
                        text("UPDATE conversations SET title = :title WHERE conversation_id = :cid"),
                        {"title": title, "cid": str(conversation.conversation_id)},
                    )
                    self._commit_persisting_rls(organization_id, conversation.user_id)
                    yield self._sse("title_update", {"title": title})
                except Exception:
                    logger.warning("Failed to persist conversation title", exc_info=True)
                    self.session.rollback()

    def _maybe_route_first_message(
        self,
        conversation: Conversation,
        user_message: str,
        page_context: dict | None,
    ) -> None:
        """Phase 3 router: on the first message of a staff conversation,
        classify the user input and possibly switch persona to a specialist.

        No-op when:
        - conversation.persona is not 'staff' (callers gate this already)
        - the conversation already has any user/assistant messages

        Errors and low-confidence decisions both fall through to leaving
        persona='staff' — the router is best-effort, never blocking.
        """
        prior_user_msg = (
            self.session.query(Message)
            .filter(
                Message.conversation_id == conversation.conversation_id,
                Message.role == "user",
            )
            .first()
        )
        if prior_user_msg is not None:
            return  # not the first message

        try:
            from app.services.agent_router import RouterService
            router = RouterService(self.settings)
            decision = router.classify(user_message, page_context)
        except Exception:  # noqa: BLE001
            logger.warning(
                "Router classification raised; staying on staff persona",
                exc_info=True,
            )
            return

        history = list(conversation.persona_history or [])
        history.append(decision.to_history_entry())
        conversation.persona_history = history

        if decision.persona != conversation.persona:
            logger.info(
                "Router switched conversation %s persona %s → %s (confidence=%.2f, source=%s)",
                conversation.conversation_id,
                conversation.persona,
                decision.persona,
                decision.confidence,
                decision.source,
            )
            conversation.persona = decision.persona

        self.session.commit()

    def _attempt_retry(
        self,
        conversation: Conversation,
        ctx: AgentContext,
        policy: Any,
        ollama_messages: list[dict],
        model: str,
        user_message: str,
        all_tool_results: list[dict],
        context_text: str,
        guardrail_service: Any,
    ) -> tuple[str | None, str | None]:
        """Attempt a single retry after a retryable guardrail block.

        Uses 3-tier fallback for tool selection:
          a) context_entity_id → get_object_detail(object_id=...)
          b) object number in response/user_message → get_object_detail(object_number=...)
          c) fallback → search_collection(query=user_message, limit=5)

        Returns (retried_content, tool_name) or (None, None) on failure.
        """
        # Determine retry tool and args
        retry_tool_name = None
        retry_args: dict = {}

        if ctx.context_entity_id:
            retry_tool_name = "get_object_detail"
            retry_args = {"object_id": str(ctx.context_entity_id)}
        else:
            # Try to extract object number from user message or recent content
            obj_number = self._extract_object_number(user_message)
            if obj_number:
                retry_tool_name = "get_object_detail"
                retry_args = {"object_number": obj_number}
            else:
                retry_tool_name = "search_collection"
                retry_args = {"query": user_message[:200], "limit": 5}
                if ctx.persona == "visitor":
                    retry_args["is_discoverable"] = True

        # Execute the retry tool
        try:
            exec_result = self.registry.execute(
                retry_tool_name, retry_args, ctx,
                strip_injections=policy.strip_injection_in_prompt,
            )
            retry_tool_result = exec_result.result_for_prompt
            all_tool_results.append(exec_result.result_raw)
        except Exception:
            logger.warning("Retry tool execution failed", exc_info=True)
            return None, None

        # Append retry context to messages
        retry_messages = list(ollama_messages)
        retry_messages.append({
            "role": "tool",
            "content": (
                f"{TOOL_RESULT_PREFIX}\n"
                f"{json.dumps(retry_tool_result, default=str)}\n"
                f"{TOOL_RESULT_SUFFIX}"
            ),
        })
        retry_messages.append({
            "role": "system",
            "content": (
                "GROUNDING_FAILURE_RETRY: Previous response contained unverified claims. "
                "Use ONLY facts from tool results below. Do not guess or assume."
            ),
        })

        # Non-streaming LLM call for retry
        try:
            result = self.llm.chat(
                model, retry_messages, tools=[], num_ctx=self.settings.agent_num_ctx,
            )
            retried_content = result.content.strip()
            if retried_content:
                return retried_content, retry_tool_name
        except Exception:
            logger.warning("Retry LLM call failed", exc_info=True)

        return None, None

    @staticmethod
    def _extract_object_number(text_to_search: str) -> str | None:
        """Extract the first object number from text."""
        match = _OBJECT_NUMBER_EXTRACT_RE.search(text_to_search)
        if match:
            return match.group(1) or match.group(2)
        return None

    @staticmethod
    def _build_guardrail_metadata(
        guardrail_result: Any,
        injection_stripped: int,
        retried: bool,
        retry_tool: str | None,
        original_content: str | None,
    ) -> dict | None:
        """Build the guardrail metadata dict for message persistence."""
        has_data = (
            not guardrail_result.passed
            or guardrail_result.warnings
            or injection_stripped
            or retried
        )
        if not has_data:
            return None

        meta: dict[str, Any] = {
            "guardrails": {
                "passed": guardrail_result.passed,
                "blocked": guardrail_result.blocked,
                "retried": retried,
                "retry_tool": retry_tool,
                "warnings": guardrail_result.warnings,
            },
            "tool_injection_stripped": injection_stripped,
        }
        if original_content is not None and original_content != "":
            meta["assistant_text_original"] = original_content
        return meta

    def _store_debug_partial(self, conversation: Conversation, partial_text: str) -> None:
        """Store partial text for debugging (only when AGENT_DEBUG_STORE_PARTIAL=true).

        Stores in a Message with role='system' and a special meta tag.
        """
        try:
            debug_msg = Message(
                conversation_id=conversation.conversation_id,
                organization_id=conversation.organization_id,
                role="system",
                content=partial_text,
                meta={"_debug_partial": True},
            )
            self.session.add(debug_msg)
            self.session.commit()
        except Exception:
            logger.warning("Failed to store debug partial", exc_info=True)
            self.session.rollback()

    def _generate_title(self, conversation: Conversation, user_message: str) -> str | None:
        """Generate a short conversation title via a non-streaming LLM call."""
        try:
            result = self.llm.chat(
                self._active_model,
                [
                    {
                        "role": "system",
                        "content": (
                            "Generate a short title (max 6 words) for this conversation. "
                            "Return ONLY the title, nothing else. No quotes, no punctuation at the end."
                        ),
                    },
                    {"role": "user", "content": user_message},
                ],
                tools=[],
                num_ctx=512,
            )
            title = result.content.strip()
            # Strip wrapping quotes the model sometimes adds
            if len(title) >= 2 and title[0] in ('"', "'") and title[-1] == title[0]:
                title = title[1:-1].strip()
            if title and len(title) <= 200:
                return title
            logger.warning("Title generation returned empty or too-long result: %r", title)
        except Exception:
            logger.warning("Title generation failed", exc_info=True)

        # Fallback: first few words of the user message
        words = user_message.split()
        fallback = " ".join(words[:6])
        if len(fallback) > 50:
            fallback = fallback[:47] + "..."
        return fallback or None

    def _commit_persisting_rls(self, organization_id, user_id) -> None:
        """Commit + re-establish RLS context on the session.

        rls.set_rls_context_for_session uses ``set_config(..., is_local=true)`` —
        transaction-scoped. After ``commit()``, the local setting evaporates and
        the next transaction starts with ``current_org_id() = NULL``, which
        makes any RLS-protected SELECT return zero rows (and any RLS-protected
        INSERT raise InsufficientPrivilege).

        require_auth sets the context once at request start, which is fine for
        handlers that only read. But stream_response commits multiple times
        (user message, assistant message, conversation title) and reads
        RLS-protected tables BETWEEN commits — without this helper, the SELECT
        in _build_ollama_messages returns an empty history and the LLM call
        fails with `messages: at least one message is required`.

        Long-term fix is to make set_rls_context_for_session session-scoped
        (with cleanup on connection return), or to wrap it in a SQLAlchemy
        after_commit event hook. For now we re-call it explicitly here.
        """
        self.session.commit()
        set_rls_context_for_session(
            self.session,
            str(organization_id) if organization_id else None,
            str(user_id) if user_id else None,
        )

    def _build_ollama_messages(
        self,
        conversation: Conversation,
        persona: str,
        policy: "PersonaPolicy | None" = None,  # noqa: F821 - quoted forward ref, not evaluated at runtime
        locale: str | None = None,
        page_context: dict | None = None,
        input_mode: str | None = None,
    ) -> tuple[list[dict], str]:
        """Build the Ollama message array from DB history.

        Returns (messages, context_text) where context_text is the entity
        context injected into the system prompt (used for grounding checks).

        If page_context is provided, a compact CURRENT PAGE CONTEXT block is
        appended to the system prompt so the model sees the live route,
        entity, and workflow state on every turn.
        """
        from app.models import Organization, User, OrganizationMembership, Role
        from app.services.agent_persona import PersonaPolicy

        if policy is None:
            policy = get_persona_policy(persona)

        context_text = ""

        system_prompt = get_db_system_prompt(self.session, conversation.organization_id, persona)

        # Inject organization and user context
        context_parts = []
        org = self.session.query(Organization).filter(
            Organization.organization_id == conversation.organization_id,
        ).first()
        if org:
            context_parts.append(f"Organization: {org.name}")

        if conversation.user_id:
            user = self.session.query(User).filter(
                User.user_id == conversation.user_id,
            ).first()
            if user and user.display_name:
                context_parts.append(f"User: {user.display_name}")

            # Get role display name
            role_row = (
                self.session.query(Role.display_name)
                .join(OrganizationMembership, OrganizationMembership.role_id == Role.role_id)
                .filter(
                    OrganizationMembership.user_id == conversation.user_id,
                    OrganizationMembership.organization_id == conversation.organization_id,
                )
                .first()
            )
            if role_row:
                context_parts.append(f"Role: {role_row.display_name}")

        # Inject entity context if the conversation is linked to a specific record
        if conversation.context_entity_type == 'collection_object' and conversation.context_entity_id:
            from app.models import CollectionObject
            obj = self.session.query(CollectionObject).filter(
                CollectionObject.object_id == conversation.context_entity_id,
                CollectionObject.organization_id == conversation.organization_id,
            ).first()
            if obj:
                if persona == 'visitor' and org:
                    obj_url = f"/c/{org.slug}/objects/{obj.object_id}"
                else:
                    obj_url = f"/organizations/{conversation.organization_id}/collections/objects/{obj.object_id}"
                context_parts.append(f"\nThe user is currently viewing object: [{obj.object_number}]({obj_url}) — {obj.object_name or 'Untitled'}")
                context_parts.append(f"Object ID: {obj.object_id}")

                # Enrich with storytelling fields, filtered through policy.context_fields
                detail_parts = self._build_context_details(obj, policy)
                if detail_parts:
                    detail_str = "; ".join(detail_parts)
                    context_parts.append("Object details: " + detail_str)
                    context_text = detail_str

                context_parts.append(
                    "When the user refers to 'this object', 'this record', 'this piece', or asks questions without "
                    "specifying an object, use this object as the default context. You already have the key details "
                    "above — use them to respond directly without needing a tool call. "
                    "Never fabricate URLs — only use the link above or links returned by tools."
                )
        elif conversation.context_entity_type and conversation.context_entity_id and persona == 'staff':
            from app.services.agent_tools.form_registry import FORM_REGISTRY, get_entity_model_map
            entity_model_map = get_entity_model_map()
            form_def = FORM_REGISTRY.get(conversation.context_entity_type)
            if form_def and conversation.context_entity_type in entity_model_map:
                model_cls, pk_field, number_field = entity_model_map[conversation.context_entity_type]
                entity = self.session.query(model_cls).filter(
                    getattr(model_cls, pk_field) == conversation.context_entity_id,
                    model_cls.organization_id == conversation.organization_id,
                ).first()
                if entity:
                    identifier = (
                        getattr(entity, number_field, None) if number_field else None
                    ) or str(conversation.context_entity_id)
                    status = getattr(entity, 'status', None)
                    context_parts.append(
                        f"\nThe user is working on a {form_def.entity_label} record: {identifier}"
                    )
                    if status:
                        label = form_def.status_labels.get(status, status)
                        context_parts.append(f"Current status: {label}")
                    empty_required = [
                        f for f in form_def.fields
                        if f.required and not getattr(entity, f.name, None)
                    ]
                    if empty_required:
                        context_parts.append(
                            f"Empty required fields: {', '.join(f.label for f in empty_required)}"
                        )
                    context_parts.append(
                        "The user may ask for help filling out this form. Use get_record_summary "
                        "for the full field state, then apply your museum knowledge to guide them. "
                        "You help — you never fill in data for them."
                    )

        if context_parts:
            system_prompt += "\n\n" + "\n".join(context_parts)

        # Collection scope disclosure (issue #77): for collection-facing staff
        # personas, surface what the collection covers / how complete it is /
        # what's missing, so the Guide answers coverage questions and never
        # implies partial holdings are comprehensive. Excluded for the public
        # visitor persona — internal completeness/gap notes aren't visitor-facing
        # in v1.
        if persona != "visitor":
            from app.services.collection_scope import build_collection_scope_block
            scope_block = build_collection_scope_block(
                self.session, conversation.organization_id
            )
            if scope_block:
                system_prompt += "\n\n" + scope_block

        # Inject the user's own preferences as SUBORDINATE stylistic guidance —
        # layered below the org prompt and context, never overriding the rules,
        # persona, or guardrails above. Skipped for the visitor persona (no
        # authenticated staff user) and a no-op when the user has set nothing.
        if conversation.user_id and persona != "visitor":
            user_prefs = get_user_preferences(
                self.session, conversation.user_id, conversation.organization_id,
            )
            if user_prefs:
                system_prompt += (
                    "\n\n## This user's preferences\n"
                    "Personal preferences for how you respond to this user. Honor them "
                    "only where they do not conflict with the instructions above:\n"
                    + user_prefs
                )
                logger.debug(
                    "Applied Guide user preferences for user=%s org=%s",
                    conversation.user_id, conversation.organization_id,
                )

        # Per-turn page snapshot from the frontend. Appended AFTER the
        # persisted conversation context so the live page wins on conflicts.
        page_block = self._format_page_context_block(page_context)
        if page_block:
            system_prompt += "\n\n" + page_block

        # Inject locale instruction for multi-language support
        if locale and locale != "en" and persona == "visitor":
            locale_names = {
                "es": "Spanish", "fr": "French", "zh": "Chinese",
                "ja": "Japanese", "de": "German",
            }
            lang_name = locale_names.get(locale, locale)
            system_prompt += (
                f"\n\nIMPORTANT: The visitor's preferred language is {lang_name} ({locale}). "
                f"Respond in {lang_name}. Keep all object titles, proper nouns, and markdown "
                f"links as-is, but write your conversational text in {lang_name}."
            )

        # Voice mode: the reply will be read aloud — shape it for listening
        if input_mode == "voice" and persona == "visitor":
            system_prompt += (
                "\n\nVOICE MODE: The visitor is speaking rather than typing, and "
                "your reply will be read aloud. Keep it conversational and under "
                "about 80 words. Prefer one vivid detail over a list of facts. "
                "Skip markdown links unless the visitor asks where to find "
                "something — say the object's name naturally instead."
            )

        messages = [{"role": "system", "content": system_prompt}]

        # Limit history to avoid exceeding Ollama context window
        MAX_HISTORY_MESSAGES = 50
        db_messages = (
            self.session.query(Message)
            .filter(Message.conversation_id == conversation.conversation_id)
            .order_by(Message.created_at.desc())
            .limit(MAX_HISTORY_MESSAGES)
            .all()
        )
        db_messages.reverse()  # Back to chronological order

        for m in db_messages:
            msg: dict = {"role": m.role, "content": m.content or ""}
            if m.tool_calls:
                msg["tool_calls"] = m.tool_calls
            messages.append(msg)

        return messages, context_text

    def _build_context_details(self, obj: Any, policy: "PersonaPolicy") -> list[str]:  # noqa: F821 - quoted forward ref, not evaluated at runtime
        """Build context detail strings filtered through policy.context_fields.

        Values are sanitized (injection patterns stripped) when policy requires it.
        """
        from app.services.agent_persona import PersonaPolicy

        fields = policy.context_fields
        strip = policy.strip_injection_in_prompt

        detail_parts = []

        if "object_name" in fields and obj.object_name:
            detail_parts.append(f"Title: {self._sanitize_context_value(obj.object_name, strip)}")

        if "creators" in fields and obj.creators:
            from app.serializers.discover import _extract_creators_list
            creator_names = _extract_creators_list(obj.creators)
            if creator_names:
                val = ", ".join(creator_names)
                detail_parts.append(f"Creator(s): {self._sanitize_context_value(val, strip)}")

        if "creation_date_display" in fields and obj.creation_date_display:
            detail_parts.append(f"Date: {self._sanitize_context_value(obj.creation_date_display, strip)}")

        if "style_period" in fields and obj.style_period:
            detail_parts.append(f"Style/Period: {self._sanitize_context_value(obj.style_period, strip)}")

        if "creation_place" in fields and obj.creation_place:
            detail_parts.append(f"Place: {self._sanitize_context_value(obj.creation_place, strip)}")

        if "brief_description" in fields and obj.brief_description:
            desc = obj.brief_description[:500]
            detail_parts.append(f"Description: {self._sanitize_context_value(desc, strip)}")

        if "materials" in fields and hasattr(obj, "materials") and obj.materials:
            val = obj.materials if isinstance(obj.materials, str) else json.dumps(obj.materials, default=str)
            detail_parts.append(f"Materials: {self._sanitize_context_value(val, strip)}")

        if "techniques" in fields and hasattr(obj, "techniques") and obj.techniques:
            val = obj.techniques if isinstance(obj.techniques, str) else json.dumps(obj.techniques, default=str)
            detail_parts.append(f"Techniques: {self._sanitize_context_value(val, strip)}")

        if "dimensions" in fields and hasattr(obj, "dimensions") and obj.dimensions:
            val = obj.dimensions if isinstance(obj.dimensions, str) else json.dumps(obj.dimensions, default=str)
            detail_parts.append(f"Dimensions: {self._sanitize_context_value(val, strip)}")

        if "provenance" in fields and hasattr(obj, "provenance") and obj.provenance:
            val = obj.provenance[:500]
            detail_parts.append(f"Provenance: {self._sanitize_context_value(val, strip)}")

        if "comments" in fields and hasattr(obj, "comments") and obj.comments:
            val = obj.comments[:500]
            detail_parts.append(f"Comments: {self._sanitize_context_value(val, strip)}")

        return detail_parts

    @staticmethod
    def _sanitize_context_value(value: str, strip: bool) -> str:
        """Sanitize a context value by stripping injection patterns if required."""
        if not strip:
            return value
        for pattern in _INJECTION_PATTERNS:
            value = pattern.sub("[REDACTED]", value)
        return value

    @staticmethod
    def _format_page_context_block(page_context: dict | None) -> str | None:
        """Render a compact CURRENT PAGE CONTEXT block for the system prompt.

        Kept tight on purpose — this runs on every turn, so bloating it would
        eat tokens for no marginal benefit. ≤12 lines in the worst case.
        String values are injection-stripped before being shown to the model.
        """
        if not page_context:
            return None

        def _clean(value: str, limit: int = 200) -> str:
            if not isinstance(value, str):
                return ""
            truncated = value[:limit]
            for pattern in _INJECTION_PATTERNS:
                truncated = pattern.sub("[REDACTED]", truncated)
            return truncated

        lines: list[str] = ["CURRENT PAGE CONTEXT"]

        route = _clean(page_context.get("route", ""), limit=256)
        if route:
            lines.append(f"- Route: {route}")

        product = _clean(page_context.get("product") or "", limit=64)
        nav_item = _clean(page_context.get("navItemId") or page_context.get("nav_item_id") or "", limit=128)
        if product or nav_item:
            segments = [s for s in (product, nav_item) if s]
            lines.append(f"- Section: {' / '.join(segments)}")

        entity = page_context.get("entity")
        if isinstance(entity, dict):
            e_type = _clean(entity.get("type") or "", limit=64)
            e_id = _clean(entity.get("id") or "", limit=128)
            e_label = _clean(entity.get("label") or "", limit=200)
            if e_type or e_label or e_id:
                label_part = f' "{e_label}"' if e_label else ""
                id_part = f" (id: {e_id})" if e_id else ""
                lines.append(f"- Viewing: {e_type}{label_part}{id_part}")

        workflow = page_context.get("workflow")
        if isinstance(workflow, dict):
            status = _clean(workflow.get("status") or "", limit=64)
            blocking_count = workflow.get("blockingCount")
            if blocking_count is None:
                blocking_count = workflow.get("blocking_count")
            top_blockers = workflow.get("topBlockers") or workflow.get("top_blockers") or []
            if status:
                if blocking_count and blocking_count > 0:
                    lines.append(
                        f"- Workflow: {status} — {blocking_count} blocking "
                        f"requirement{'s' if blocking_count != 1 else ''} remain"
                    )
                    # Show up to 5 blockers (matching the schema cap). The
                    # earlier 3-item cap caused Claude to confabulate the
                    # remaining blockers from general workflow knowledge
                    # whenever blocking_count > 3, which produced plausible
                    # but sometimes wrong guesses. Giving it all 5 costs
                    # ~40 tokens per workflow turn and eliminates the
                    # guessing behavior entirely.
                    for blocker in list(top_blockers)[:5]:
                        if isinstance(blocker, str) and blocker:
                            lines.append(f"  • {_clean(blocker, limit=200)}")
                else:
                    lines.append(f"- Workflow: {status} — ready")

        edit_mode = page_context.get("editMode")
        if edit_mode is None:
            edit_mode = page_context.get("edit_mode")
        if edit_mode is not None:
            lines.append(f"- Edit mode: {'on' if edit_mode else 'off'}")

        lines.append(
            "When this block is present, prefer it over asking the user "
            "'which record?' or 'where are you?' — it IS the live UI state."
        )

        return "\n".join(lines) if len(lines) > 1 else None

    @staticmethod
    def _sse(event: str, data: dict) -> str:
        """Format a Server-Sent Event."""
        return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def get_agent_service(session) -> AgentService:
    """Get an AgentService instance bound to the given SQLAlchemy session."""
    return AgentService(session=session)
