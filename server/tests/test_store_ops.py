"""Unit tests for the synchronous store operations in modal_app.

These run against a plain dict, with no sockets involved. The two structural
tests at the bottom are the point of the split: the read-modify-write on the
store is only atomic because nothing in these functions can yield to the
event loop (a plain `def` cannot contain `await`), and because the handler
never reads or writes the store itself, so no handler-level read can be
separated from its write by an `await`.
"""

import ast
import inspect
import re
from pathlib import Path

import pytest

import modal_app
from messages import ErrorCode, Move, Promotion
from modal_app import (
    STORE_OPERATIONS,
    CopyingStore,
    GameError,
    accept_draw,
    accept_rematch,
    accept_takeback,
    claim_seat,
    create_game,
    decline_draw,
    decline_rematch,
    decline_takeback,
    find_seat,
    offer_draw,
    offer_rematch,
    record_move,
    request_takeback,
    resign,
    taken_seats,
)


@pytest.fixture()
def white_creator(monkeypatch):
    monkeypatch.setattr(modal_app._rng, "choice", lambda seq: "white")


def move(frm, to, promotion=None):
    return Move.model_validate(
        {"type": "move", "from": frm, "to": to, **({"promotion": promotion} if promotion else {})}
    )


def test_create_game_claims_one_seat(white_creator):
    store = CopyingStore()
    gid, color = create_game(store)
    assert len(gid) == 6
    assert color == "white"
    assert store[gid] == {"seats": ["white"], "moves": []}


def test_create_game_gives_the_creator_the_side_asked_for(white_creator):
    store = CopyingStore()
    gid, color = create_game(store, "tab-a", "black")
    assert color == "black"
    assert store[gid] == {"seats": ["black"], "moves": [], "claimants": {"black": "tab-a"}}
    assert claim_seat(store, gid) == ("white", False)


def test_create_game_never_reuses_an_id(monkeypatch):
    store = CopyingStore({"AAAAAA": {"seats": ["white"], "moves": []}})
    ids = iter(["AAAAAA", "BBBBBB"])
    monkeypatch.setattr(modal_app._rng, "choices", lambda *a, **k: list(next(ids)))
    gid, _ = create_game(store)
    assert gid == "BBBBBB"


def test_an_id_create_game_would_never_make_is_never_looked_up():
    class Watched(dict):
        def get(self, key, default=None):
            raise AssertionError(f"looked up {key[:20]!r}")

    store = Watched()
    for gid in ["x" * 1_000_000, "abcdef", "ABCDE", "ABCDEFG", "ABC-DE"]:
        for op in (claim_seat, taken_seats):
            with pytest.raises(GameError) as refused:
                op(store, gid)
            assert refused.value.code == ErrorCode.invalid_game
        with pytest.raises(GameError):
            find_seat(store, gid, "white")


def test_create_game_makes_ids_of_the_shape_looked_up():
    store = CopyingStore()
    for _ in range(50):
        gid, _ = create_game(store)
        assert modal_app.GAME_ID.fullmatch(gid)


def test_claim_seat_takes_the_free_color(white_creator):
    store = CopyingStore()
    gid, _ = create_game(store)
    assert claim_seat(store, gid) == ("black", False)
    assert store[gid]["seats"] == ["white", "black"]


def test_claim_seat_remembers_and_recognises_the_claimant(white_creator):
    store = CopyingStore()
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
    store = CopyingStore({"FULL00": {"seats": ["white", "black"], "moves": []}})
    with pytest.raises(GameError) as e:
        claim_seat(store, "NOPE00")
    assert e.value.code.value == "invalid_game"
    with pytest.raises(GameError) as e:
        claim_seat(store, "FULL00")
    assert e.value.code.value == "game_full"
    # A rejected claim never touches the store
    assert store["FULL00"]["seats"] == ["white", "black"]


def test_taken_seats(white_creator):
    store = CopyingStore()
    gid, _ = create_game(store)
    assert taken_seats(store, gid) == ["white"]
    claim_seat(store, gid)
    assert taken_seats(store, gid) == ["white", "black"]
    with pytest.raises(GameError) as err:
        taken_seats(store, "MISSING")
    assert err.value.code.value == "invalid_game"


def test_find_seat():
    store = CopyingStore({"G00001": {"seats": ["white"], "moves": []}})
    assert find_seat(store, "G00001", "white") is not None
    with pytest.raises(GameError) as e:
        find_seat(store, "G00001", "black")
    assert e.value.code.value == "invalid_rejoin"
    with pytest.raises(GameError) as e:
        find_seat(store, "MISSING", "white")
    assert e.value.code.value == "invalid_game"


def test_record_move_enforces_game_state_and_turn():
    store = CopyingStore({"G00001": {"seats": ["white"], "moves": []}})
    with pytest.raises(GameError) as e:
        record_move(store, None, None, move("Aa2", "Aa3"))
    assert e.value.code.value == "invalid_move"
    with pytest.raises(GameError) as e:
        record_move(store, "G00001", "white", move("Aa2", "Aa3"))
    assert e.value.code.value == "game_not_started"

    store["G00001"] = {**store["G00001"], "seats": ["white", "black"]}
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


def under_way():
    return CopyingStore({"G00001": {"seats": ["white", "black"], "moves": []}})


def refusal(op, *args):
    with pytest.raises(GameError) as e:
        op(*args)
    return e.value.code.value


def test_resign_ends_the_game_for_the_opponent():
    store = under_way()
    assert resign(store, "G00001", "black") == {"result": "resignation", "winner": "white"}
    assert store["G00001"]["ending"] == {"result": "resignation", "winner": "white"}
    # Nothing more is accepted: moves, a second resignation, offers and answers
    assert refusal(record_move, store, "G00001", "white", move("Aa2", "Aa3")) == "game_over"
    assert refusal(resign, store, "G00001", "white") == "game_over"
    assert refusal(offer_draw, store, "G00001", "white") == "game_over"
    assert refusal(accept_draw, store, "G00001", "white") == "game_over"
    assert refusal(decline_draw, store, "G00001", "white") == "game_over"
    for op in (request_takeback, accept_takeback, decline_takeback):
        assert refusal(op, store, "G00001", "white") == "game_over"
    assert store["G00001"]["moves"] == []


def test_resign_and_offers_need_a_game_under_way():
    store = CopyingStore({"G00001": {"seats": ["white"], "moves": []}})
    for op in (
        resign,
        offer_draw,
        accept_draw,
        decline_draw,
        request_takeback,
        accept_takeback,
        decline_takeback,
    ):
        assert refusal(op, store, None, None) == "game_not_started"
        assert refusal(op, store, "G00001", "white") == "game_not_started"
    assert store["G00001"] == {"seats": ["white"], "moves": []}


def test_a_draw_offer_accepted_ends_the_game_drawn():
    store = under_way()
    assert offer_draw(store, "G00001", "white") == {"by": "white", "ply": 0}
    # Only the opponent can answer it, and only one offer stands
    assert refusal(accept_draw, store, "G00001", "white") == "invalid_draw"
    assert refusal(decline_draw, store, "G00001", "white") == "invalid_draw"
    assert refusal(offer_draw, store, "G00001", "black") == "invalid_draw"
    assert refusal(offer_draw, store, "G00001", "white") == "invalid_draw"
    assert accept_draw(store, "G00001", "black") == {"result": "agreement"}
    assert store["G00001"]["ending"] == {"result": "agreement"}
    assert refusal(record_move, store, "G00001", "white", move("Aa2", "Aa3")) == "game_over"


def test_a_draw_offer_declined_or_lapsed():
    store = under_way()
    record_move(store, "G00001", "white", move("Aa2", "Aa3"))
    # Offered on the opponent's turn, and declined
    assert offer_draw(store, "G00001", "white") == {"by": "white", "ply": 1}
    assert decline_draw(store, "G00001", "black") == {"by": "white", "ply": 1, "declined": True}
    assert "ending" not in store["G00001"]
    # Answered once; and offered once a move, by either side
    assert refusal(accept_draw, store, "G00001", "black") == "invalid_draw"
    assert refusal(decline_draw, store, "G00001", "black") == "invalid_draw"
    assert refusal(offer_draw, store, "G00001", "white") == "invalid_draw"
    assert refusal(offer_draw, store, "G00001", "black") == "invalid_draw"
    # A move makes a new offer possible, which the next move cancels
    record_move(store, "G00001", "black", move("Ea4", "Ea3"))
    assert offer_draw(store, "G00001", "black") == {"by": "black", "ply": 2}
    record_move(store, "G00001", "white", move("Aa3", "Aa4"))
    assert refusal(accept_draw, store, "G00001", "white") == "invalid_draw"
    assert refusal(decline_draw, store, "G00001", "white") == "invalid_draw"
    # ...and the game goes on, a new offer welcome
    assert offer_draw(store, "G00001", "white") == {"by": "white", "ply": 3}
    assert store["G00001"]["drawOffer"] == {"by": "white", "ply": 3}


def test_a_take_back_granted_removes_the_move_and_its_reply():
    store = under_way()
    # Nothing to take back before a move of one's own
    assert refusal(request_takeback, store, "G00001", "white") == "invalid_takeback"
    record_move(store, "G00001", "white", move("Aa2", "Aa3"))
    assert refusal(request_takeback, store, "G00001", "black") == "invalid_takeback"
    record_move(store, "G00001", "black", move("Ea4", "Ea3"))
    offer_draw(store, "G00001", "black")
    # On White's own turn: the move and Black's reply go
    assert request_takeback(store, "G00001", "white") == {"by": "white", "ply": 2}
    # Only the opponent can answer it, and only one request stands
    assert refusal(accept_takeback, store, "G00001", "white") == "invalid_takeback"
    assert refusal(request_takeback, store, "G00001", "white") == "invalid_takeback"
    assert refusal(request_takeback, store, "G00001", "black") == "invalid_takeback"
    record = accept_takeback(store, "G00001", "black")
    assert record["moves"] == [] and store["G00001"]["moves"] == []
    # The offer and the request name plies the game can reach again: both go
    assert "drawOffer" not in store["G00001"]
    assert "takebackRequest" not in store["G00001"]
    # On the opponent's turn: the requester's move alone goes
    record_move(store, "G00001", "white", move("Aa2", "Aa3"))
    request_takeback(store, "G00001", "white")
    accept_takeback(store, "G00001", "black")
    assert store["G00001"]["moves"] == []


def test_a_take_back_declined_or_lapsed():
    store = under_way()
    record_move(store, "G00001", "white", move("Aa2", "Aa3"))
    assert request_takeback(store, "G00001", "white") == {"by": "white", "ply": 1}
    assert decline_takeback(store, "G00001", "black") == {"by": "white", "ply": 1, "declined": True}
    assert len(store["G00001"]["moves"]) == 1
    # Answered once, and asked for once a move
    assert refusal(accept_takeback, store, "G00001", "black") == "invalid_takeback"
    assert refusal(request_takeback, store, "G00001", "white") == "invalid_takeback"
    # A move cancels a standing request
    record_move(store, "G00001", "black", move("Ea4", "Ea3"))
    request_takeback(store, "G00001", "black")
    record_move(store, "G00001", "white", move("Aa3", "Aa4"))
    assert refusal(accept_takeback, store, "G00001", "white") == "invalid_takeback"
    assert refusal(decline_takeback, store, "G00001", "white") == "invalid_takeback"
    assert len(store["G00001"]["moves"]) == 3


def test_a_rematch_accepted_starts_a_game_with_the_colours_swapped():
    store = under_way()
    store["G00001"] = {**store["G00001"], "claimants": {"white": "tab-w", "black": "tab-b"}}
    resign(store, "G00001", "white")
    assert offer_rematch(store, "G00001", "white") == {"by": "white"}
    # Only the opponent can answer it, and it is offered once
    assert refusal(accept_rematch, store, "G00001", "white") == "invalid_rematch"
    assert refusal(decline_rematch, store, "G00001", "white") == "invalid_rematch"
    assert refusal(offer_rematch, store, "G00001", "white") == "invalid_rematch"
    started = accept_rematch(store, "G00001", "black")
    new_gid = started["gameId"]
    assert started == {"by": "white", "gameId": new_gid}
    assert store["G00001"]["rematch"] == started
    # Both seats taken, each player (and each tab's claim) on the other side
    assert store[new_gid] == {
        "seats": ["white", "black"],
        "moves": [],
        "claimants": {"black": "tab-w", "white": "tab-b"},
    }
    # Begun once: nothing more to offer or answer
    for op in (offer_rematch, accept_rematch, decline_rematch):
        assert refusal(op, store, "G00001", "black") == "invalid_rematch"
        assert refusal(op, store, "G00001", "white") == "invalid_rematch"
    # The new game is under way, and can be rematched in turn
    record_move(store, new_gid, "white", move("Aa2", "Aa3"))
    assert offer_rematch(store, new_gid, "black") == {"by": "black"}


def test_a_rematch_offered_by_both_starts_it():
    store = under_way()
    offer_rematch(store, "G00001", "black")
    started = offer_rematch(store, "G00001", "white")
    assert started == {"by": "black", "gameId": started["gameId"]}
    assert store[started["gameId"]] == {"seats": ["white", "black"], "moves": []}


def test_a_rematch_declined():
    store = under_way()
    offer_rematch(store, "G00001", "white")
    assert decline_rematch(store, "G00001", "black") == {"by": "white", "declined": True}
    assert len(store) == 1
    # Answered once; the player declined cannot ask again...
    assert refusal(accept_rematch, store, "G00001", "black") == "invalid_rematch"
    assert refusal(decline_rematch, store, "G00001", "black") == "invalid_rematch"
    assert refusal(offer_rematch, store, "G00001", "white") == "invalid_rematch"
    # ...but the one who declined may change their mind
    assert offer_rematch(store, "G00001", "black") == {"by": "black"}
    assert accept_rematch(store, "G00001", "white")["by"] == "black"


def test_a_rematch_needs_both_players():
    store = CopyingStore({"G00001": {"seats": ["white"], "moves": []}})
    for op in (offer_rematch, accept_rematch, decline_rematch):
        assert refusal(op, store, None, None) == "game_not_started"
        assert refusal(op, store, "G00001", "white") == "game_not_started"
    assert store == {"G00001": {"seats": ["white"], "moves": []}}


def test_store_operations_are_synchronous():
    """Guards the concurrency argument documented in ARCHITECTURE.md/CLAUDE.md.

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
    tree = ast.parse(inspect.getsource(modal_app.create_web_app))
    names = {op.__name__ for op in STORE_OPERATIONS}
    handed = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and getattr(node.func, "id", None) in names:
            handed.update(id(a) for a in node.args if isinstance(a, ast.Name) and a.id == "store")
    # The one other use: the default, `if store is None: store = CopyingStore()`
    default = tree.body[0].body[0]
    assert ast.unparse(default) == "if store is None:\n    store = CopyingStore()"
    allowed = {id(default.test.left)}
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id == "store" and isinstance(node.ctx, ast.Load):
            assert id(node) in handed | allowed, (
                f"handler must only hand `store` to a store operation (line {node.lineno})"
            )


def test_every_store_function_is_a_synchronous_store_operation():
    """A function given the store (its first parameter) is a store operation:
    listed in STORE_OPERATIONS (so the tests above see it) unless private, and
    synchronous either way."""
    listed = set(STORE_OPERATIONS)
    for name, fn in inspect.getmembers(modal_app, inspect.isfunction):
        # (the handler's factory takes the store too: the test above covers it)
        if fn.__module__ != modal_app.__name__ or fn is modal_app.create_web_app:
            continue
        params = list(inspect.signature(fn).parameters)
        if not params or params[0] != "store":
            continue
        assert not inspect.iscoroutinefunction(fn), f"{name} must stay synchronous"
        assert name.startswith("_") or fn in listed, f"{name} is missing from STORE_OPERATIONS"


def test_the_store_is_never_used_through_its_async_variants():
    """modal.Dict's `.aio` calls await, which would open the read-modify-write
    window the synchronous store operations close."""
    code = [
        node.attr
        for node in ast.walk(ast.parse(inspect.getsource(modal_app)))
        if isinstance(node, ast.Attribute)
    ]
    assert "aio" not in code


def test_the_local_store_copies_as_modal_dict_does():
    """A record changed after it was written, or on a read never written back,
    is not changed in the store: the property every store operation's
    write-back relies on in production."""
    store = CopyingStore()
    record = {"moves": []}
    store["G00001"] = record
    record["moves"].append("after the write")
    store.get("G00001")["moves"].append("on a read")
    store["G00001"]["moves"].append("on another read")
    assert store == {"G00001": {"moves": []}}


def test_the_docs_name_every_store_operation_and_nothing_else():
    """CLAUDE.md and ARCHITECTURE.md list the store operations by hand; a new
    one added to STORE_OPERATIONS (or one taken out) must be named there too,
    or the next change reads a stale list of what may not await."""
    root = Path(__file__).resolve().parents[2]
    names = {op.__name__ for op in STORE_OPERATIONS}
    for doc in ("CLAUDE.md", "ARCHITECTURE.md"):
        text = " ".join((root / doc).read_text(encoding="utf-8").split())
        listed = re.search(r"the store operations (?:in `modal_app\.py` )?\(([^)]*)\)", text)
        assert listed, f"{doc}: no list of the store operations"
        assert set(re.findall(r"`(\w+)`", listed.group(1))) == names, doc
