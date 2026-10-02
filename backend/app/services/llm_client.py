"""
LLM client abstraction for agent inference.

Supports Ollama (local), RunPod serverless, and Claude API backends.
All expose the same interface so agent_service.py doesn't care which is active.
"""

import json
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Generator

import requests

logger = logging.getLogger(__name__)


@dataclass
class ChatChunk:
    """A single chunk from a streaming chat response."""
    content: str = ""
    tool_calls: list[dict] = field(default_factory=list)
    done: bool = False
    warming_up: bool = False
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass
class ChatResponse:
    """A complete (non-streaming) chat response."""
    content: str = ""
    tool_calls: list[dict] = field(default_factory=list)
    # Per-call token usage when the upstream provider reports it. 0 when
    # unknown (e.g. Ollama doesn't expose per-call accounting). Used by
    # the Tier 2 eval budget guard and any future cost-attribution
    # telemetry; production callers ignore these fields today.
    input_tokens: int = 0
    output_tokens: int = 0


class LLMClient(ABC):
    """Abstract interface for LLM chat completions."""

    @abstractmethod
    def chat_stream(
        self,
        model: str,
        messages: list[dict],
        tools: list[dict],
        num_ctx: int,
    ) -> Generator[ChatChunk, None, None]:
        """Stream chat completions, yielding chunks with content/tool_calls."""

    @abstractmethod
    def chat(
        self,
        model: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        num_ctx: int = 32768,
    ) -> ChatResponse:
        """Blocking chat completion, returns complete response."""


class OllamaClient(LLMClient):
    """Ollama /api/chat client — wraps existing behavior."""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def chat_stream(
        self,
        model: str,
        messages: list[dict],
        tools: list[dict],
        num_ctx: int,
    ) -> Generator[ChatChunk, None, None]:
        response = requests.post(
            f"{self.base_url}/api/chat",
            json={
                "model": model,
                "messages": messages,
                "tools": tools,
                "stream": True,
                "options": {"num_ctx": num_ctx},
            },
            stream=True,
            timeout=120,
        )
        response.raise_for_status()

        for line in response.iter_lines():
            if not line:
                continue
            try:
                chunk = json.loads(line)
            except json.JSONDecodeError:
                continue

            msg = chunk.get("message", {})
            yield ChatChunk(
                content=msg.get("content", ""),
                tool_calls=msg.get("tool_calls", []),
                done=chunk.get("done", False),
            )

            if chunk.get("done"):
                return

    def chat(
        self,
        model: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        num_ctx: int = 32768,
    ) -> ChatResponse:
        response = requests.post(
            f"{self.base_url}/api/chat",
            json={
                "model": model,
                "messages": messages,
                "tools": tools or [],
                "stream": False,
                "options": {"num_ctx": num_ctx},
            },
            timeout=120,
        )
        response.raise_for_status()
        data = response.json()
        msg = data.get("message", {})
        return ChatResponse(
            content=msg.get("content", ""),
            tool_calls=msg.get("tool_calls", []),
        )


class RunPodClient(LLMClient):
    """RunPod serverless client using llama-cpp-python handler.

    Uses RunPod's native /runsync (blocking) and /run + /status (async)
    endpoints. The handler returns OpenAI-format chat completion responses.

    Since RunPod serverless doesn't support streaming, chat_stream() falls
    back to a blocking call and yields the full response as a single chunk.
    """

    POLL_INTERVAL = 2  # seconds between status polls
    MAX_POLL_TIME = 300  # 5 minutes max wait (includes cold start)

    def __init__(self, api_key: str, endpoint_id: str):
        if not api_key:
            raise ValueError("RUNPOD_API_KEY is required when agent_provider=runpod")
        if not endpoint_id:
            raise ValueError("RUNPOD_ENDPOINT_ID is required when agent_provider=runpod")
        self.api_key = api_key
        self.endpoint_id = endpoint_id
        self.base_url = f"https://api.runpod.ai/v2/{endpoint_id}"

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _build_input(
        self,
        messages: list[dict],
        tools: list[dict] | None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> dict:
        """Build the RunPod handler input payload."""
        body: dict = {
            "messages": self._normalize_messages(messages),
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if tools:
            body["tools"] = self._normalize_tools_request(tools)
        return body

    @staticmethod
    def _normalize_messages(messages: list[dict]) -> list[dict]:
        """Normalize messages from Ollama/internal format to OpenAI format.

        The agent loop stores tool_calls in Ollama format (no id/type fields)
        and tool results without tool_call_id. llama-cpp-python requires
        full OpenAI-format messages.
        """
        normalized = []
        call_counter = 0

        for msg in messages:
            m = dict(msg)

            if m.get("tool_calls"):
                # llama-cpp-python chatml requires content=null (not "") for tool-call-only messages
                if m.get("content") == "":
                    m["content"] = None
                # Add id/type fields if missing
                fixed_calls = []
                for tc in m["tool_calls"]:
                    if "id" not in tc:
                        call_counter += 1
                        tc = dict(tc)
                        tc["id"] = f"call_{call_counter}"
                    if "type" not in tc:
                        tc = dict(tc)
                        tc["type"] = "function"
                    # Ensure arguments is a JSON string, not a dict
                    func = tc.get("function", {})
                    if isinstance(func.get("arguments"), dict):
                        func = dict(func)
                        func["arguments"] = json.dumps(func["arguments"])
                        tc = dict(tc)
                        tc["function"] = func
                    fixed_calls.append(tc)
                m["tool_calls"] = fixed_calls

            if m.get("role") == "tool" and "tool_call_id" not in m:
                # Match to the most recent assistant tool_call
                m["tool_call_id"] = f"call_{call_counter}"

            normalized.append(m)

        return normalized

    def _run_sync(self, input_data: dict) -> dict:
        """Submit a job via /runsync (blocks up to 30s on RunPod side).

        Falls back to async /run + polling if the job takes longer.
        """
        response = requests.post(
            f"{self.base_url}/runsync",
            headers=self._headers(),
            json={"input": input_data},
            timeout=120,
        )
        response.raise_for_status()
        data = response.json()

        status = data.get("status")
        if status == "COMPLETED":
            return data.get("output", {})

        if status == "IN_QUEUE" or status == "IN_PROGRESS":
            # Job didn't finish within runsync timeout — poll for result
            job_id = data.get("id")
            return self._poll_for_result(job_id)

        if status == "FAILED":
            error = data.get("error", "Unknown error")
            raise RuntimeError(f"RunPod job failed: {error}")

        return data.get("output", {})

    def _poll_for_result(self, job_id: str) -> dict:
        """Poll /status/{job_id} until the job completes."""
        elapsed = 0
        while elapsed < self.MAX_POLL_TIME:
            time.sleep(self.POLL_INTERVAL)
            elapsed += self.POLL_INTERVAL

            response = requests.get(
                f"{self.base_url}/status/{job_id}",
                headers=self._headers(),
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()

            status = data.get("status")
            if status == "COMPLETED":
                return data.get("output", {})
            if status == "FAILED":
                error = data.get("error", "Unknown error")
                raise RuntimeError(f"RunPod job failed: {error}")

        raise TimeoutError(f"RunPod job {job_id} timed out after {self.MAX_POLL_TIME}s")

    def _parse_response(self, output: dict) -> ChatResponse:
        """Parse OpenAI-format response from the handler."""
        if "error" in output:
            raise RuntimeError(f"RunPod handler error: {output['error']}")

        choices = output.get("choices", [])
        if not choices:
            return ChatResponse()

        msg = choices[0].get("message", {})
        tool_calls = msg.get("tool_calls", [])
        if tool_calls:
            tool_calls = self._normalize_tool_calls_response(tool_calls)

        return ChatResponse(
            content=msg.get("content", "") or "",
            tool_calls=tool_calls,
        )

    @staticmethod
    def _normalize_tools_request(tools: list[dict]) -> list[dict]:
        """Ensure tools are in OpenAI format."""
        normalized = []
        for tool in tools:
            if "type" in tool and tool["type"] == "function":
                normalized.append(tool)
            elif "function" in tool:
                normalized.append({"type": "function", "function": tool["function"]})
            else:
                normalized.append({"type": "function", "function": tool})
        return normalized

    @staticmethod
    def _normalize_tool_calls_response(tool_calls: list[dict]) -> list[dict]:
        """Normalize tool_calls to match Ollama format (arguments as dict)."""
        normalized = []
        for tc in tool_calls:
            func = tc.get("function", {})
            args = func.get("arguments", {})
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except (json.JSONDecodeError, TypeError):
                    args = {}
            normalized.append({
                "function": {
                    "name": func.get("name", ""),
                    "arguments": args,
                },
            })
        return normalized

    def chat_stream(
        self,
        model: str,
        messages: list[dict],
        tools: list[dict],
        num_ctx: int,
    ) -> Generator[ChatChunk, None, None]:
        """RunPod serverless doesn't support true streaming.

        Falls back to a blocking call and yields the complete response
        as a single chunk. The agent_service handles this transparently
        since it accumulates content regardless.
        """
        input_data = self._build_input(messages, tools)
        logger.info("RunPod request: %d messages, %d tools", len(messages), len(tools))

        # Check if workers are available before submitting
        cold_start = False
        try:
            health = requests.get(
                f"{self.base_url}/health",
                headers=self._headers(),
                timeout=5,
            )
            if health.ok:
                workers = health.json().get("workers", {})
                ready = workers.get("ready", 0) + workers.get("idle", 0)
                cold_start = ready == 0
                logger.info("RunPod health: ready=%d idle=%d cold_start=%s",
                           workers.get("ready", 0), workers.get("idle", 0), cold_start)
        except Exception as e:
            logger.warning("RunPod health check failed: %s", e)

        if cold_start:
            yield ChatChunk(warming_up=True)

        # Use runsync for warm workers (fast), async run+poll for cold starts
        if cold_start:
            response = requests.post(
                f"{self.base_url}/run",
                headers=self._headers(),
                json={"input": input_data},
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
            output = self._poll_for_result(data.get("id"))
        else:
            output = self._run_sync(input_data)

        result = self._parse_response(output)

        yield ChatChunk(
            content=result.content,
            tool_calls=result.tool_calls,
            done=True,
        )

    def chat(
        self,
        model: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        num_ctx: int = 32768,
    ) -> ChatResponse:
        input_data = self._build_input(messages, tools)
        output = self._run_sync(input_data)
        return self._parse_response(output)


class ClaudeClient(LLMClient):
    """Anthropic Claude API client.

    Converts between the internal message format (Ollama-style) and the
    Anthropic Messages API format. Supports true streaming via the SDK.
    """

    def __init__(self, api_key: str, model: str = "claude-haiku-4-5", max_tokens: int = 4096):
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is required when agent_provider=claude")
        import anthropic
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = model
        self.max_tokens = max_tokens

    @staticmethod
    def _convert_tools(tools: list[dict]) -> list[dict]:
        """Convert OpenAI/Ollama tool format to Anthropic format."""
        converted = []
        for tool in tools:
            func = tool.get("function", tool)
            converted.append({
                "name": func["name"],
                "description": func.get("description", ""),
                "input_schema": func.get("parameters", {"type": "object", "properties": {}}),
            })
        return converted

    @staticmethod
    def _convert_messages(messages: list[dict]) -> tuple[str, list[dict]]:
        """Convert internal messages to Anthropic format.

        Returns (system_prompt, messages) since Anthropic takes system
        as a separate parameter.

        Key differences from Ollama/OpenAI format:
        - System message extracted as separate param
        - Tool calls become tool_use content blocks
        - Tool results become tool_result content blocks with tool_use_id
        """
        system = ""
        converted = []
        call_id_counter = 0
        last_tool_use_ids: list[str] = []

        for msg in messages:
            role = msg.get("role", "")

            if role == "system":
                system = msg.get("content", "")
                continue

            if role == "user":
                converted.append({"role": "user", "content": msg.get("content", "")})
                continue

            if role == "assistant":
                content_blocks = []
                text = msg.get("content", "")
                if text:
                    content_blocks.append({"type": "text", "text": text})

                tool_calls = msg.get("tool_calls", [])
                last_tool_use_ids = []
                for tc in tool_calls:
                    call_id_counter += 1
                    tool_use_id = tc.get("id", f"toolu_{call_id_counter:04d}")
                    last_tool_use_ids.append(tool_use_id)
                    func = tc.get("function", {})
                    args = func.get("arguments", {})
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except (json.JSONDecodeError, TypeError):
                            args = {}
                    content_blocks.append({
                        "type": "tool_use",
                        "id": tool_use_id,
                        "name": func.get("name", ""),
                        "input": args,
                    })

                if not content_blocks:
                    content_blocks.append({"type": "text", "text": " "})
                converted.append({"role": "assistant", "content": content_blocks})
                continue

            if role == "tool":
                tool_use_id = msg.get("tool_call_id", "")
                if not tool_use_id and last_tool_use_ids:
                    tool_use_id = last_tool_use_ids.pop(0)
                tool_result_block = {
                    "type": "tool_result",
                    "tool_use_id": tool_use_id,
                    "content": msg.get("content", ""),
                }
                # Merge consecutive tool results into one user message
                if converted and converted[-1].get("role") == "user" and \
                        isinstance(converted[-1].get("content"), list) and \
                        converted[-1]["content"] and \
                        isinstance(converted[-1]["content"][0], dict) and \
                        converted[-1]["content"][0].get("type") == "tool_result":
                    converted[-1]["content"].append(tool_result_block)
                else:
                    converted.append({
                        "role": "user",
                        "content": [tool_result_block],
                    })
                continue

        return system, converted

    @staticmethod
    def _extract_tool_calls(content_blocks: list) -> list[dict]:
        """Extract tool calls from Anthropic content blocks into internal format."""
        tool_calls = []
        for block in content_blocks:
            if hasattr(block, "type") and block.type == "tool_use":
                tool_calls.append({
                    "function": {
                        "name": block.name,
                        "arguments": block.input if isinstance(block.input, dict) else {},
                    },
                    "id": block.id,
                })
            elif isinstance(block, dict) and block.get("type") == "tool_use":
                tool_calls.append({
                    "function": {
                        "name": block["name"],
                        "arguments": block.get("input", {}),
                    },
                    "id": block.get("id", ""),
                })
        return tool_calls

    def chat_stream(
        self,
        model: str,
        messages: list[dict],
        tools: list[dict],
        num_ctx: int,
    ) -> Generator[ChatChunk, None, None]:
        system, converted_messages = self._convert_messages(messages)
        converted_tools = self._convert_tools(tools) if tools else []

        logger.info("Claude request: model=%s, %d messages, %d tools",
                     self.model, len(converted_messages), len(converted_tools))

        kwargs: dict = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": converted_messages,
        }
        if system:
            # Use prompt caching for the system prompt (identical every call)
            kwargs["system"] = [
                {"type": "text", "text": system, "cache_control": {"type": "ephemeral"}},
            ]
        if converted_tools:
            # Cache tool definitions too — mark the last tool for caching
            # (Anthropic caches everything up to and including the cached block)
            converted_tools[-1]["cache_control"] = {"type": "ephemeral"}
            kwargs["tools"] = converted_tools

        accumulated_tool_calls: list[dict] = []
        current_tool: dict | None = None
        current_tool_json = ""
        input_tokens = 0
        output_tokens = 0

        with self.client.messages.stream(**kwargs) as stream:
            for event in stream:
                if event.type == "content_block_start":
                    block = event.content_block
                    if hasattr(block, "type") and block.type == "tool_use":
                        current_tool = {
                            "id": block.id,
                            "name": block.name,
                        }
                        current_tool_json = ""

                elif event.type == "content_block_delta":
                    delta = event.delta
                    if hasattr(delta, "type"):
                        if delta.type == "text_delta":
                            yield ChatChunk(content=delta.text)
                        elif delta.type == "input_json_delta" and current_tool is not None:
                            current_tool_json += delta.partial_json

                elif event.type == "content_block_stop":
                    if current_tool is not None:
                        try:
                            args = json.loads(current_tool_json) if current_tool_json else {}
                        except json.JSONDecodeError:
                            args = {}
                        accumulated_tool_calls.append({
                            "function": {
                                "name": current_tool["name"],
                                "arguments": args,
                            },
                            "id": current_tool["id"],
                        })
                        current_tool = None
                        current_tool_json = ""

                elif event.type == "message_delta":
                    # Capture token usage from the final delta
                    usage = getattr(event, "usage", None)
                    if usage:
                        input_tokens = getattr(usage, "input_tokens", 0) or 0
                        output_tokens = getattr(usage, "output_tokens", 0) or 0

                elif event.type == "message_stop":
                    # Get token counts from the accumulated message
                    final_msg = stream.get_final_message()
                    if final_msg and hasattr(final_msg, "usage"):
                        input_tokens = final_msg.usage.input_tokens
                        output_tokens = final_msg.usage.output_tokens
                    yield ChatChunk(
                        tool_calls=accumulated_tool_calls,
                        done=True,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                    )
                    return

        # Stream ended without message_stop (shouldn't happen, but be safe)
        yield ChatChunk(tool_calls=accumulated_tool_calls, done=True)

    def chat(
        self,
        model: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        num_ctx: int = 32768,
    ) -> ChatResponse:
        system, converted_messages = self._convert_messages(messages)
        converted_tools = self._convert_tools(tools) if tools else []

        kwargs: dict = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": converted_messages,
        }
        if system:
            kwargs["system"] = [
                {"type": "text", "text": system, "cache_control": {"type": "ephemeral"}},
            ]
        if converted_tools:
            converted_tools[-1]["cache_control"] = {"type": "ephemeral"}
            kwargs["tools"] = converted_tools

        response = self.client.messages.create(**kwargs)

        content = ""
        tool_calls = []
        for block in response.content:
            if hasattr(block, "type"):
                if block.type == "text":
                    content += block.text
                elif block.type == "tool_use":
                    tool_calls.append({
                        "function": {
                            "name": block.name,
                            "arguments": block.input if isinstance(block.input, dict) else {},
                        },
                        "id": block.id,
                    })

        usage = getattr(response, "usage", None)
        input_tokens = getattr(usage, "input_tokens", 0) or 0 if usage else 0
        output_tokens = getattr(usage, "output_tokens", 0) or 0 if usage else 0

        return ChatResponse(
            content=content,
            tool_calls=tool_calls,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )


def get_llm_client(settings) -> LLMClient:
    """Factory: return the appropriate LLM client based on config."""
    provider = getattr(settings, "agent_provider", "ollama")

    if provider == "claude":
        return ClaudeClient(
            api_key=settings.anthropic_api_key,
            model=settings.agent_claude_model,
            max_tokens=settings.agent_claude_max_tokens,
        )

    if provider == "runpod":
        return RunPodClient(
            api_key=settings.runpod_api_key,
            endpoint_id=settings.runpod_endpoint_id,
        )

    return OllamaClient(base_url=settings.ollama_base_url)
