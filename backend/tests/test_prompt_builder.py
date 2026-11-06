"""Prompt construction tests."""

from __future__ import annotations

from app.schemas.chat import ChatMessage
from app.services.prompt_builder import build_prompt, build_usage, estimate_tokens


def _messages(*pairs) -> list[ChatMessage]:
    return [ChatMessage(role=role, content=content) for role, content in pairs]


def test_a_single_user_message_is_used_verbatim():
    prompt = build_prompt(_messages(("user", "Explain Python.")))

    assert prompt == "Explain Python."


def test_a_system_message_is_prepended():
    prompt = build_prompt(_messages(("system", "Be brief."), ("user", "Hi")))

    assert prompt.startswith("Be brief.")
    assert prompt.endswith("Hi")


def test_a_conversation_is_flattened_into_a_transcript():
    prompt = build_prompt(
        _messages(
            ("user", "Hi"),
            ("assistant", "Hello!"),
            ("user", "What is Python?"),
        )
    )

    assert "User: Hi" in prompt
    assert "Assistant: Hello!" in prompt
    assert prompt.endswith("User: What is Python?")


def test_structured_content_parts_are_flattened():
    messages = [
        ChatMessage(
            role="user",
            content=[{"type": "text", "text": "part one"}, {"type": "text", "text": "part two"}],
        )
    ]

    assert "part one" in build_prompt(messages)
    assert "part two" in build_prompt(messages)


def test_token_estimation_is_positive():
    assert estimate_tokens("") == 0
    assert estimate_tokens("hello world") >= 1


def test_usage_adds_up():
    usage = build_usage("a" * 40, "b" * 80)

    assert usage["total_tokens"] == usage["prompt_tokens"] + usage["completion_tokens"]
