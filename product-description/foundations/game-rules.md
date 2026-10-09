# The rules

## Summary

3D Chess is chess on a 5 × 5 × 5 cube: five stacked 5 × 5 boards, played with the familiar pieces plus the Unicorn, which moves along the cube's space diagonals. This document owns every rule the player plays by: the board and its coordinates, the starting position, how each piece moves, pawns and promotion, check, checkmate, and stalemate, the draws, resigning and agreed draws, and what standard chess has that this game does not. It has no interaction of its own. Feature documents link here instead of restating a rule.

The rules are enforced only by each player's own browser: it offers only legal moves, and it decides by itself when the game is over. The server records whatever it is sent in turn; see [who enforces the rules](#who-enforces-the-rules).

## The board

The board has 125 [cells](../glossary.md#the-board). A cell is named by three characters, always in this order:

| Part | Name | Values | Meaning for White | Meaning for Black |
| --- | --- | --- | --- | --- |
| First, upper case | Level | A B C D E | A is White's bottom level; *up* is toward E | E is Black's bottom level; *up* is toward A |
| Second, lower case | File | a b c d e | left to right, a to e | the same files, drawn right to left (see [orientation](the-view.md#orientation)) |
| Third, digit | Rank | 1 2 3 4 5 | 1 is White's back rank; *forward* is toward 5 | 5 is Black's back rank; *forward* is toward 1 |

So `Aa1` is White's home corner and `Ee5` is Black's. The same notation appears in the [move list](../game-page/move-list.md) (which only screen readers see), is what the player types into the [move box](input-model.md#the-move-box), and is used in every message the server exchanges, but on the board itself only its parts appear: the files and ranks are written along two edges of the bottom level and each level's letter beside its level, so a player who wants to find `Cc3` reads off the level, then the file and rank. How the levels, files, and ranks are laid out on screen is in [the view](the-view.md#orientation).

## The starting position

Each side has 20 pieces: a King, a Queen, two Rooks, two Knights, two Bishops, two Unicorns, and ten Pawns, on the two ranks and two levels nearest its own corner. The pieces stand on the side's bottom level and the pawns on the level above, two rows of five.

| Cells | White | Cells | Black |
| --- | --- | --- | --- |
| Level A, rank 1 (`Aa1`–`Ae1`) | Rook, Knight, King, Knight, Rook | Level E, rank 5 (`Ea5`–`Ee5`) | Rook, Knight, King, Knight, Rook |
| Level A, rank 2 (`Aa2`–`Ae2`) | Bishop, Unicorn, Queen, Bishop, Unicorn | Level E, rank 4 (`Ea4`–`Ee4`) | Unicorn, Bishop, Queen, Unicorn, Bishop |
| Level B, ranks 1 and 2 (`Ba1`–`Be2`) | ten Pawns | Level D, ranks 4 and 5 (`Da4`–`De5`) | ten Pawns |

Black's position is White's turned through the center of the cube: every piece at level, file, rank is matched by the same piece at the opposite level, opposite file, opposite rank. That is why Black's second rank reads Unicorn, Bishop, Queen, Unicorn, Bishop from file a: seen from Black's side it is the same Bishop, Unicorn, Queen, Bishop, Unicorn that White sees. Level C and rank 3 are empty at the start. (This is the traditional 5 × 5 × 5 set-up, with the pieces on rank 1 of levels A and B and the pawns on rank 2, with rank and level exchanged; every rule treats the two alike, so it is the same game move for move.)

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

- **Check.** The side to move's King is attacked by at least one opposing piece. The player must answer it: every move offered is one that leaves the King unattacked. Check is shown on the board only, by the [check glow](the-view.md#markers-and-colors): the King rocks on his foot as the check lands and turns red, among dark blades of obsidian. The [turn pill](../game-page/turn-indicator.md) does not mark it; a screen reader hears "Check." in the [move announcement](../glossary.md#the-interface).
- **Checkmate.** The side to move is in check and has no legal move. The other side wins.
- **Stalemate.** The side to move is not in check and has no legal move. The game is a draw.

Two Kings can never stand next to each other, since each attacks all 26 cells around it. Because Kings in three dimensions have so many escape cells, patterns that mate on a flat board usually do not mate here; the shortest mate from the starting position takes four moves (two by each side, with the losing side cooperating).

## Draws by repetition and the fifty-move rule

Besides stalemate, the game is drawn automatically, as in chess, in two more ways:

- **Repetition.** The same position stands for the third time: the same pieces on the same cells and the same side to move. The three need not be in a row. Since there is no castling and no en passant, a position is only that. A capture or a pawn move can never be undone, so only positions since the last capture or pawn move can repeat.
- **The fifty-move rule.** Fifty moves by each side (a hundred moves in all) have been played with no capture and no pawn move.

Nobody claims either draw: it happens on the move that completes it, as checkmate and stalemate do. A move that mates wins, even if it also completes a repetition or the fifty moves. Each browser decides these draws from the move record, like the rest of the rules, and the [computer](../computer/playing-the-computer.md) plays by them too.

## Resigning and agreed draws

The players can also end a game themselves. Either may resign at any moment, on their move or not, and the opponent wins. Either may offer a draw, which the opponent accepts or declines; a draw can be offered once between two moves, by either side, and an offer stands until it is answered or a move is played. An ending on the board comes first: once a mate or an automatic draw has landed, neither is possible. Unlike the board's endings these are recorded by the server, which refuses any move, resignation, or offer after them. How they are made is in [resigning and draws](../play/resigning-and-draws.md); against the computer, which never offers a draw and accepts one only when it stands clearly worse, see [playing the computer](../computer/playing-the-computer.md).

What happens on screen when the game ends is in [check and the end of the game](../play/check-and-game-end.md).

## What standard chess has that this game does not

- No castling.
- No two-cell pawn first move, and so no en passant.
- No draw by insufficient material. A game with only the two Kings left goes on until the fifty-move rule (or a repetition) draws it.
- No clock. A player may take as long as they like, and an opponent who has walked away can only be resigned against or waited for.

## Who enforces the rules

Each player's browser holds the complete rules and applies them in four places: it offers only legal destinations for the selected piece, it accepts only a legal move typed into the move box, it marks a King that is in check, and it decides after every move whether the game is over (checkmate, stalemate, repetition, or the fifty-move rule). In a game against the computer the browser also stands in for the server and refuses an illegal move outright; see [playing the computer](../computer/playing-the-computer.md). The two browsers reach the same conclusions because they replay the same [move record](../glossary.md#games-and-seats) with the same rules.

The server checks only that a move names two valid cells, carries a promotion letter only from the allowed five, and comes from the side whose turn it is. It does not check that the piece exists, that the move is legal, or that the game is still in progress on the board; it refuses moves only once the players have ended the game by a resignation or an agreed draw. A correct client never sends anything else, so a player using the app never sees the difference; what a player sees if the record ever contains a move their browser cannot replay is described in [the broken game record](../cross-cutting/broken-game-record.md).

> Technical note: The browser works out the position by replaying the whole move record from the starting position every time the record changes. There is no stored board anywhere; the move record is the game.

## Open questions and verification

- The mirrored starting position, the 61 opening moves (also counted against the engine at `b325641` for this refresh), the movement of every piece, pawn edges, promotion squares, check detection, and the mate and stalemate patterns are covered by the engine's unit tests (`client/src/engine/board.test.ts`, `board.reference.test.ts`); the shortest mate is the line played by `client/e2e/gameOver.spec.ts`.
- The starting position changed since the earlier drafts of this description (the Bishops, Unicorns, and Queen moved from level B to rank 2 of level A, and the pawns to both ranks of level B); read from `Board.setupStartingPosition` in `client/src/engine/board.ts`.
- The draws are read from `client/src/engine/draws.ts` and `client/src/game/history.ts` and covered by `draws.test.ts` and `history.test.ts`; not played out by hand.
- A game reduced to two Kings is not drawn at once; it ends only by the fifty-move rule or a repetition. A player may expect an immediate draw.

Drafted against 3D Chess commit `b325641`
