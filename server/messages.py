# generated by datamodel-codegen:
#   filename:  schema.json
#   timestamp: 2025-04-28T07:26:47+00:00
#   command:   datamodel-codegen --input server/schema.json --input-file-type jsonschema --output server/messages.py --output-model-type pydantic_v2.BaseModel

from __future__ import annotations

from enum import Enum
from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, RootModel, constr


class CreateGame(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['create_game']


class GameCreated(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['game_created']
    gameId: str


class JoinGame(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['join_game']
    gameId: str


class Color(Enum):
    white = 'white'
    black = 'black'


class GameStart(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['game_start']
    color: Color
    initialPosition: Optional[str] = None


class Promotion(Enum):
    Q = 'Q'
    R = 'R'
    B = 'B'
    N = 'N'
    U = 'U'


class Move(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['move']
    from_: constr(pattern=r'^[A-E][a-e][1-5]$') = Field(..., alias='from')
    to: constr(pattern=r'^[A-E][a-e][1-5]$')
    promotion: Optional[Promotion] = None


class By(Enum):
    white = 'white'
    black = 'black'


class MoveMade(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['move_made']
    by: By
    from_: constr(pattern=r'^[A-E][a-e][1-5]$') = Field(..., alias='from')
    to: constr(pattern=r'^[A-E][a-e][1-5]$')
    promotion: Optional[Promotion] = None


class Error(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['error']
    code: str
    message: str


class WebsocketV1MessageEnvelope(
    RootModel[
        Union[CreateGame, GameCreated, JoinGame, GameStart, Move, MoveMade, Error]
    ]
):
    root: Union[CreateGame, GameCreated, JoinGame, GameStart, Move, MoveMade, Error] = (
        Field(..., title='WebSocket V1 Message Envelope')
    )
