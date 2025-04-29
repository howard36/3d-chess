

import pytest
from messages import CreateGame, Move, JoinGame

@pytest.mark.parametrize("Model, data", [
    (CreateGame, {"type": "create_game"}),
    (JoinGame, {"type": "join_game", "gameId": "xyz"}),
    (Move,      {"type": "move", "from": "Aa1", "to": "Ab2"}),
])
def test_parse(Model, data):
    model = Model(**data)
    assert model.type == data["type"] 