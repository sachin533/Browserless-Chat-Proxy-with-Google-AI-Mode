"""Prompt construction and response helpers for the Google AI Mode pipeline."""

from __future__ import annotations

from typing import Iterable

from app.schemas.chat import ChatMessage

SYSTEM_PREFIX = (
    "You are being accessed through the Google AI Mode API. "
    "Answer the final user message directly and concisely."
)

def build_prompt(messages: Iterable[ChatMessage]) -> str:
    """Flatten an OpenAI style message list into a single browser prompt.

    Google AI Mode accepts a single prompt per turn, therefore a multi turn
    conversation is flattened into an explicit transcript.  The last user
    message always stays at the bottom so the model treats it as the current
    instruction.
    """
    messages = list(messages)
    if not messages:
        return ""

    system_parts = [
        message.text().strip()
        for message in messages
        if message.role == "system" and message.text().strip()
    ]
    history = [message for message in messages if message.role != "system"]

    if not history:
        return "\n\n".join(system_parts)

    if len(history) == 1:
        body = history[0].text().strip()
    else:
        transcript_parts: list[str] = []
        for message in history:
            label = {
                "user": "User",
                "assistant": "Assistant",
                "tool": "Tool",
                "function": "Function",
            }.get(message.role, "User")
            content = message.text().strip()
            if not content:
                continue
            transcript_parts.append(f"{label}: {content}")
        body = "\n\n".join(transcript_parts)

    header = "\n\n".join(system_parts)
    prompt = f"{header}\n\n{body}" if header else body
    return prompt.strip()


def estimate_tokens(text: str) -> int:
    """Rough token estimate (~4 characters per token)."""
    if not text:
        return 0
    return max(1, len(text) // 4)


def build_usage(prompt: str, completion: str) -> dict[str, int]:
    """Return an OpenAI compatible usage block based on character estimates."""
    prompt_tokens = estimate_tokens(prompt)
    completion_tokens = estimate_tokens(completion)
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
    }
