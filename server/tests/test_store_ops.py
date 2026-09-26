"""Unit tests for the synchronous store operations in modal_app.

These run against a plain dict, with no sockets involved. The two structural
tests at the bottom are the point of the split: the read-modify-write on the
store is only atomic because nothing in these functions can yield to the
event loop (a plain `def` cannot contain `await`), and because the handler
never reads or writes the store itself, so no handler-level read can be
separated from its write by an `await`.
"""

import inspect

import pytest

import modal_app
from messages import Move, Promotion
from modal_app import (
    STORE_OPERATIONS,
    GameError,
    claim_seat,
    create_game,
    find_seat,
    record_move,
)


@pytest.fixture()
def white_creator(monkeypatch):
    monkeypatch.setattr(modal_app.random, "choice", lambda seq: "white")


def move(frm, to, promotion=None):
    return Move.model_validate(
        {"type": "move", "from": frm, "to": to, **({"promotion": promotion} if promotion else {})}
    )


def test_create_game_claims_one_seat(white_creator):
    store = {}
    gid, color = create_game(store)
    assert len(gid) == 6
    assert color == "white"
    assert store[gid] == {"seats": ["white"], "moves": []}


def test_create_game_never_reuses_an_id(monkeypatch):
    store = {"AAAAAA": {"seats": ["white"], "moves": []}}
    ids = iter(["AAAAAA", "BBBBBB"])
    monkeypatch.setattr(modal_app.random, "choices", lambda *a, **k: list(next(ids)))
    gid, _ = create_game(store)
    assert gid == "BBBBBB"


def test_claim_seat_takes_the_free_color(white_creator):
    store = {}
    gid, _ = create_game(store)
    assert claim_seat(store, gid) == ("black", False)
    assert store[gid]["seats"] == ["white", "black"]


def test_claim_seat_remembers_and_recognises_the_claimant(white_creator):
    store = {}
    gid, _ = create_game(store, "tab-a")
    assert store[gid]["claimants"] == {"white": "tab-a"}
    assert claim_seat(store, gid, "tab-b") == ("black", False)
    assert store[gid]["claimants"] == {"white": "tab-a", "black": "tab-b"}
    # Either claimant joining again gets its own seat back; nobody else gets in
    assert claim_seat(store, gid, "tab-b") == ("black", True)
    assert claim_seat(store, gid, "tab-a") == ("white", True)
    assert store[gid]["seats"] == ["white", "black"]
    with pytest.raises(GameError) as e:
        claim_seat(store, gid, "tab-c")
    assert e.value.code.value == "game_full"
    with pytest.raises(GameError):
        claim_seat(store, gid)


def test_claim_seat_errors():
    store = {"FULL00": {"seats": ["white", "black"], "moves": []}}
    with pytest.raises(GameError) as e:
        claim_seat(store, "NOPE00")
    assert e.value.code.value == "invalid_game"
    with pytest.raises(GameError) as e:
        claim_seat(store, "FULL00")
    assert e.value.code.value == "game_full"
    # A rejected claim never touches the store
    assert store["FULL00"]["seats"] == ["white", "black"]


def test_find_seat():
    store = {"G00001": {"seats": ["white"], "moves": []}}
    assert find_seat(store, "G00001", "white") is not None
    with pytest.raises(GameError) as e:
        find_seat(store, "G00001", "black")
    assert e.value.code.value == "invalid_rejoin"
    with pytest.raises(GameError) as e:
        find_seat(store, "MISSING", "white")
    assert e.value.code.value == "invalid_game"


def test_record_move_enforces_game_state_and_turn():
    store = {"G00001": {"seats": ["white"], "moves": []}}
    with pytest.raises(GameError) as e:
        record_move(store, None, None, move("Aa2", "Aa3"))
    assert e.value.code.value == "invalid_move"
    with pytest.raises(GameError) as e:
        record_move(store, "G00001", "white", move("Aa2", "Aa3"))
    assert e.value.code.value == "game_not_started"

    store["G00001"]["seats"].append("black")
    with pytest.raises(GameError) as e:
        record_move(store, "G00001", "black", move("Ea4", "Ea3"))
    assert e.value.code.value == "wrong_turn"

    assert record_move(store, "G00001", "white", move("Aa2", "Aa3")) == {
        "by": "white",
        "from": "Aa2",
        "to": "Aa3",
    }
    assert record_move(store, "G00001", "black", move("Ea4", "Ea5", "Q")) == {
        "by": "black",
        "from": "Ea4",
        "to": "Ea5",
        "promotion": "Q",
    }
    assert [m["by"] for m in store["G00001"]["moves"]] == ["white", "black"]
    assert store["G00001"]["moves"][1]["promotion"] == Promotion.Q.value


def test_store_operations_are_synchronous():
    """Guards the concurrency argument documented in README/CLAUDE.md.

    modal.Dict calls block, so a store operation is atomic with respect to
    other handlers exactly as long as it never awaits. A plain `def` cannot
    contain `await`; a future `async def` conversion fails this test.
    """
    for op in STORE_OPERATIONS:
        assert not inspect.iscoroutinefunction(op), f"{op.__name__} must stay synchronous"


def test_handler_never_touches_the_store_directly():
    """The other half of the argument: a handler that read a record, awaited,
    and wrote it back would race, and the sync store operations could not
    prevent it. So the handler may only hand `store` to those operations.
    """
    source = inspect.getsource(modal_app.create_web_app)
    for forbidden in ("store[", "store.get(", " in store"):
        assert forbidden not in source, f"handler must not access the store directly: {forbidden}"
