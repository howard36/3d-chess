# The rules

## Summary

3D Chess is chess on a 5 × 5 × 5 cube: five stacked 5 × 5 boards, played with the familiar pieces plus the Unicorn, which moves along the cube's space diagonals. This document owns every rule the player plays by: the board and its coordinates, the starting position, how each piece moves, pawns and promotion, check, checkmate, and stalemate, and what standard chess has that this game does not. It has no interaction of its own. Feature documents link here instead of restating a rule.

The rules are enforced only by each player's own browser: it offers only legal moves, and it decides by itself when the game is over. The server records whatever it is sent in turn; see [who enforces the rules](#who-enforces-the-rules).

## The board

The board has 125 [cells](../glossary.md#the-board). A cell is named by three characters, always in this order:

| Part | Name | Values | Meaning for White | Meaning for Black |
| --- | --- | --- | --- | --- |
| First, upper case | Level | A B C D E | A is White's bottom level; *up* is toward E | E is Black's bottom level; *up* is toward A |
| Second, lower case | File | a b c d e | left to right, a to e | the same files, drawn right to left (see [orientation](the-view.md#orientation)) |
| Third, digit | Rank | 1 2 3 4 5 | 1 is White's back rank; *forward* is toward 5 | 5 is Black's back rank; *forward* is toward 1 |

So `Aa1` is White's home corner and `Ee5` is Black's. The same notation appears in the [move list](../game-page/move-list.md), is what the player types into the [move box](input-model.md#the-move-box), and is used in every message the server exchanges, but it appears nowhere on the board itself: cells carry no labels, and a player who wants to find `Cc3` has to count. How the levels, files, and ranks are laid out on screen is in [the view](the-view.md#orientation).

## The starting position

Each side has 20 pieces: a King, a Queen, two Rooks, two Knights, two Bishops, two Unicorns, and ten Pawns, on the two ranks and two levels nearest its own corner.

| Cells | White | Cells | Black |
| --- | --- | --- | --- |
| Level A, rank 1 (`Aa1`–`Ae1`) | Rook, Knight, King, Knight, Rook | Level E, rank 5 (`Ea5`–`Ee5`) | Rook, Knight, King, Knight, Rook |
| Level B, rank 1 (`Ba1`–`Be1`) | Bishop, Unicorn, Queen, Bishop, Unicorn | Level D, rank 5 (`Da5`–`De5`) | Unicorn, Bishop, Queen, Unicorn, Bishop |
| Levels A and B, rank 2 (`Aa2`–`Ae2`, `Ba2`–`Be2`) | ten Pawns | Levels E and D, rank 4 (`Ea4`–`Ee4`, `Da4`–`De4`) | ten Pawns |

Black's position is White's turned through the center of the cube: every piece at level, file, rank is matched by the same piece at the opposite level, opposite file, opposite rank. That is why Black's second back rank reads Unicorn, Bishop, Queen, Unicorn, Bishop from file a: seen from Black's side it is the same Bishop, Unicorn, Queen, Bishop, Unicorn that White sees. Levels C and ranks 3 are empty at the start.

White moves first. In the starting position White has 61 legal moves, and Black, by symmetry, the same.

## How the pieces move

A *line* is a direction the piece repeats. Sliding pieces (Rook, Bishop, Unicorn, Queen) move any number of cells along one of their lines, up to the edge of the board, and stop at the first piece in the way: they may capture it if it is the opponent's and may not pass it. The King and the Knight make a single step or jump.

| Piece | Moves along | Directions | Slides |
| --- | --- | --- | --- |
| Rook | exactly one axis: along a rank, along a file, or straight between levels | 6 | yes |
| Bishop | exactly two axes by the same amount: a diagonal within a level, or a diagonal between levels along a rank or a file | 12 | yes |
| Unicorn | all three axes by the same amount: a diagonal through the cube | 8 | yes |
| Queen | any Rook, Bishop, or Unicorn line | 26 | yes |
| King | any Queen direction, one cell | 26 | no |
| Knight | two cells along one axis and one along another, in any combination of axes | 24 | no, it jumps over anything in between |

A piece may not move onto a cell held by its own side. A move onto an opponent's piece captures it. No piece may make a move that leaves its own King attacked; the browser does not offer such moves at all.

## Pawns

Pawns are the one piece whose moves depend on its color and on whether it is capturing.

- **Quiet moves.** A pawn steps one cell *forward* (along its rank) or one cell *up* (to the next level), the player's choice, onto an empty cell. There is no two-cell first move.
- **Captures.** A pawn captures only onto an opponent's piece, in one of five directions: forward and up at once, forward and one file to either side, or up and one file to either side. For White these are one rank toward 5 and one level toward E; forward-left and forward-right along the same level; up-left and up-right on the same rank. Black's are the mirror image. A pawn cannot capture straight forward or straight up, and cannot move diagonally without capturing.
- **No en passant.**
- **Edges.** A White pawn on rank 5 below level E can no longer step forward; it can still step up, or capture up and to the side. A White pawn on level E can no longer step up; it can still step forward, or capture forward and to the side. Black's pawns are limited the same way at rank 1 and level A.

A pawn attacks its five capture cells whether or not anything stands on them, which is what matters for check: a King may not step onto a cell an opposing pawn attacks, even an empty one.

## Promotion

A pawn that reaches its side's [promotion square](../glossary.md#moves-and-the-rules) must become a Queen, Rook, Bishop, Knight, or Unicorn, chosen by the player in the [promotion dialog](../play/promotion.md). The promotion squares are the five cells at the far corner edge of the cube:

- White: rank 5 on level E (`Ea5`–`Ee5`), the row where Black's King and back rank start.
- Black: rank 1 on level A (`Aa1`–`Ae1`), where White's King and back rank start.

A pawn reaches them by a quiet step (forward from rank 4 on the top level, or up from level D on the last rank) or by a capture. Reaching rank 5 on any other level, or level E on any other rank, does not promote. There is no limit on how many pieces of a type a side can have after promoting.

## Check, checkmate, and stalemate

These work as in standard chess, across all three dimensions.

- **Check.** The side to move's King is attacked by at least one opposing piece. The player must answer it: every move offered is one that leaves the King unattacked. The board shows check by the [check glow](the-view.md#markers-and-colors) on the King, and the [turn indicator](../game-page/turn-indicator.md) adds " — in check" after "White to move" or "Black to move" while the game is not over.
- **Checkmate.** The side to move is in check and has no legal move. The other side wins.
- **Stalemate.** The side to move is not in check and has no legal move. The game is a draw.

Two Kings can never stand next to each other, since each attacks all 26 cells around it. Because Kings in three dimensions have so many escape cells, patterns that mate on a flat board usually do not mate here; the shortest mate from the starting position takes four moves (two by each side, with the losing side cooperating).

What happens on screen when the game ends is in [check and the end of the game](../play/check-and-game-end.md).

## What standard chess has that this game does not

- No castling.
- No two-cell pawn first move, and so no en passant.
- No draw by repetition, by the fifty-move rule, or by insufficient material. A game with only the two Kings left goes on until a player leaves.
- No resignation and no draw offer. A game ends only by checkmate or stalemate.
- No clock. A player may take as long as they like.

## Who enforces the rules

Each player's browser holds the complete rules and applies them in four places: it offers only legal destinations for the selected piece, it accepts only a legal move typed into the move box, it marks a King that is in check, and it decides after every move whether the game is over. The two browsers reach the same conclusions because they replay the same [move record](../glossary.md#games-and-seats) with the same rules.

The server checks only that a move names two valid cells, carries a promotion letter only from the allowed five, and comes from the side whose turn it is. It does not check that the piece exists, that the move is legal, or that the game is still in progress. A correct client never sends anything else, so a player using the app never sees the difference; what a player sees if the record ever contains a move their browser cannot replay is described in [the broken game record](../cross-cutting/broken-game-record.md).

> Technical note: The browser works out the position by replaying the whole move record from the starting position every time the record changes. There is no stored board anywhere; the move record is the game.

## Open questions and verification

- The mirrored starting position, the 61 opening moves, the movement of every piece, pawn edges, promotion squares, check detection, and the mate and stalemate patterns are covered by the engine's unit tests (`client/src/engine/board.test.ts`); the shortest mate is the line played by `client/e2e/gameOver.spec.ts`.
- A game reduced to two Kings never ends; there is no draw rule for it. This is by design (no draw rules exist) but a player may not expect it.
- The board has no coordinate labels, so the move list's notation cannot be matched to cells without counting. Whether that is intended is a product call; see [the view](the-view.md).

Verified against 3D Chess commit `c571311`
