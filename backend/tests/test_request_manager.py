"""Request manager unit tests."""

from __future__ import annotations

import asyncio

import pytest

from app.core.exceptions import ServiceBusyError
from app.services.request_manager import (
    DeltaEvent,
    ErrorEvent,
    FinalEvent,
    RequestManager,
)


@pytest.fixture
def manager(settings):
    return RequestManager(settings)


def test_request_ids_are_unique(manager):
    ids = {manager.new_request_id() for _ in range(500)}

    assert len(ids) == 500
    assert all(request_id.startswith("req_") for request_id in ids)


def test_a_response_is_matched_by_request_id(manager):
    first = manager.create(timeout=5)
    second = manager.create(timeout=5)

    assert manager.resolve(second.request_id, "second answer")
    assert not manager.resolve("req_unknown", "orphan")

    event = second.events.get_nowait()
    assert isinstance(event, FinalEvent)
    assert event.text == "second answer"
    assert first.events.empty()


def test_a_duplicate_result_is_ignored(manager):
    pending = manager.create(timeout=5)

    assert manager.resolve(pending.request_id, "answer") is True
    assert manager.resolve(pending.request_id, "answer again") is False
    assert pending.events.qsize() == 1


def test_deltas_are_delivered_in_order(manager):
    pending = manager.create(timeout=5)

    assert manager.delta(pending.request_id, "Hello ")
    assert manager.delta(pending.request_id, "world")

    assert pending.events.get_nowait() == DeltaEvent(text="Hello ")
    assert pending.events.get_nowait() == DeltaEvent(text="world")


def test_a_failure_is_terminal(manager):
    pending = manager.create(timeout=5)

    assert manager.fail(pending.request_id, "boom", "Something broke")
    event = pending.events.get_nowait()
    assert isinstance(event, ErrorEvent)
    assert event.code == "boom"
    assert pending.finished is True


def test_fail_all_clears_every_pending_request(manager):
    manager.create(timeout=5)
    manager.create(timeout=5)

    assert manager.fail_all("extension_disconnected", "gone") == 2
    assert manager.pending_count == 2  # entries stay until they are discarded


def test_cancelling_a_request_delivers_an_error(manager):
    pending = manager.create(timeout=5)

    assert manager.cancel(pending.request_id) is True
    event = pending.events.get_nowait()
    assert isinstance(event, ErrorEvent)
    assert event.code == "request_cancelled"


def test_cancelling_an_unknown_request_is_a_no_op(manager):
    assert manager.cancel("req_does_not_exist") is False


def test_the_pending_limit_is_enforced(settings):
    settings.max_pending_requests = 2
    manager = RequestManager(settings)

    manager.create(timeout=5)
    manager.create(timeout=5)

    with pytest.raises(ServiceBusyError):
        manager.create(timeout=5)


async def test_wait_for_event_times_out(manager):
    pending = manager.create(timeout=5)

    with pytest.raises(asyncio.TimeoutError):
        await manager.wait_for_event(pending, deadline=0.01)


async def test_wait_for_event_returns_the_queued_event(manager):
    pending = manager.create(timeout=5)
    manager.resolve(pending.request_id, "done")

    import time

    event = await manager.wait_for_event(pending, deadline=time.time() + 5)

    assert isinstance(event, FinalEvent)
    assert event.text == "done"


def test_discard_removes_the_request(manager):
    pending = manager.create(timeout=5)

    manager.discard(pending.request_id)

    assert manager.pending_count == 0
    assert manager.get(pending.request_id) is None
