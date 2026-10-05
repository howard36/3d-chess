import React from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { lazyChunk } from '../../lib/cachedImport';
import { ChunkBoundary } from '../../components/ChunkBoundary';
import {
  LESSONS,
  lessonById,
  practise,
  reachable,
  startPractice,
  stepFor,
} from '../../game/lessons';
import type { Lesson, Side } from '../../game/lessons';
import type { Move } from '../../engine';
import { PieceGlyph } from '../PieceGlyph';
import PromotionPicker from '../PromotionPicker';
import { Army, Directions, LevelsIcon, PromotionRow } from './Directions';
import { cardBeside } from './learnLayout';
import './learn.css';

// The board (three.js, the scene) is a chunk of its own, the one the game's
// board loads: the menu and the lesson's words show without waiting for it
const learnCanvas = lazyChunk(() => import('./LearnCanvas'));
learnCanvas.preload();

/** The address of a lesson. */
const lessonPath = (lesson: Lesson) =>
  lesson.id === LESSONS[0].id ? '/learn' : `/learn/${lesson.id}`;

/**
 * The tutorial (/learn, /learn/:lesson): the armies as a game starts, then
 * how each piece moves on the tower, for a player who knows chess. A menu of
 * the lessons in the card, the
 * tower in the middle with the lesson's piece picked up and its moves ringed
 * (a ring tapped plays the move, and the piece is picked up again where it
 * lands), and the lesson's few words in a card at the bottom. The pawn's
 * steps are each shown for White, then for Black, whose pawns go the other
 * way.
 */
const LearnScreen = () => {
  const { lesson: id } = useParams<{ lesson?: string }>();
  const lesson = id === undefined ? LESSONS[0] : lessonById(id);
  if (!lesson) return <Navigate to="/learn" replace />;
  return <LessonView lesson={lesson} />;
};

const LessonView = ({ lesson }: { lesson: Lesson }) => {
  const navigate = useNavigate();
  // The lesson's step, the side it is shown for and the position the player
  // is trying moves in, set afresh for each lesson, each step, each side and
  // each start over (a fresh board,
  // epoch: it plays only the moves made after it mounts). Reset while
  // rendering, so no frame shows the last lesson's position under this one's
  // words.
  const begin = (stepIndex: number, epoch: number, side: Side = 'white') => ({
    lesson: lesson.id,
    stepIndex,
    side,
    epoch,
    practice: startPractice(stepFor(lesson.steps[stepIndex], side)),
  });
  const [run, setRun] = React.useState(() => begin(0, 0));
  if (run.lesson !== lesson.id) setRun(begin(0, run.epoch + 1));
  const current = run.lesson === lesson.id;
  const stepIndex = current ? run.stepIndex : 0;
  const side = current ? run.side : 'white';
  const step = stepFor(lesson.steps[stepIndex], side);
  const practice = current ? run.practice : startPractice(step);
  const setStepIndex = (i: number) => setRun(begin(i, run.epoch + 1));
  const setSide = (s: Side) => setRun(begin(stepIndex, run.epoch + 1, s));
  const startOver = () => setRun(begin(stepIndex, run.epoch + 1, side));
  const play = (move: Move) => setRun((r) => ({ ...r, practice: practise(r.practice, move) }));
  const [promotion, setPromotion] = React.useState<Move[] | null>(null);

  const index = LESSONS.indexOf(lesson);
  const nextLesson = LESSONS[index + 1];
  const lastStep = stepIndex >= lesson.steps.length - 1;
  // Each of the pawn's steps for White, then for Black
  const blackNext = lesson.bothSides && side === 'white';
  const goNext = () => {
    if (blackNext) setSide('black');
    else if (!lastStep) setStepIndex(stepIndex + 1);
    else if (nextLesson) navigate(lessonPath(nextLesson));
    else navigate('/new');
  };
  const nextLabel = blackNext
    ? 'Black'
    : !lastStep
      ? lesson.steps[stepIndex + 1].label
      : nextLesson
        ? nextLesson.name
        : 'Play a game';

  const [noBoard, setNoBoard] = React.useState(false);
  const beside = useCardBeside();
  const LearnCanvas = learnCanvas.Component;
  const count = reachable(practice);

  return (
    <main className="learn" data-testid="learn" data-card={beside ? 'beside' : 'below'}>
      <div className="learn-stage">
        <ChunkBoundary onFail={() => setNoBoard(true)}>
          <React.Suspense fallback={null}>
            <LearnCanvas
              practice={practice}
              boardKey={`${run.lesson}-${run.epoch}`}
              onMove={play}
              onChoosePromotion={setPromotion}
              disabled={!!promotion}
            />
          </React.Suspense>
        </ChunkBoundary>
      </div>
      {/* Home where the lobby has it */}
      <header className="lobby-top">
        <button className="lobby-link" onClick={() => navigate('/')}>
          <span aria-hidden>←</span> Home
        </button>
      </header>
      <section
        className="learn-card hud-glass"
        aria-labelledby="learn-title"
        data-lesson={lesson.id}
      >
        {/* The lessons, one per piece, where the lesson itself and its Next are */}
        <nav className="learn-menu" aria-label="Lessons">
          {LESSONS.map((l) => (
            <button
              key={l.id}
              className="learn-tab"
              aria-current={l === lesson ? 'page' : undefined}
              aria-label={l.name}
              title={l.name}
              onClick={() => navigate(lessonPath(l), { replace: true })}
            >
              {l.piece ? <PieceGlyph type={l.piece} color="white" size={22} /> : <LevelsIcon />}
            </button>
          ))}
        </nav>
        <div className="learn-head">
          <h1 id="learn-title">{lesson.name}</h1>
          {lesson.isNew && <span className="learn-new">New</span>}
          {lesson.bothSides && (
            <div className="learn-sides" role="group" aria-label="Side">
              {(['white', 'black'] as const).map((s) => (
                <button
                  key={s}
                  className="learn-side"
                  aria-pressed={s === side}
                  aria-label={s === 'white' ? 'White' : 'Black'}
                  title={s === 'white' ? 'White' : 'Black'}
                  onClick={() => setSide(s)}
                >
                  <PieceGlyph type={lesson.piece!} color={s} size={18} />
                </button>
              ))}
            </div>
          )}
          {lesson.steps.length > 1 && (
            <div className="learn-steps" role="group" aria-label={`${lesson.name} lessons`}>
              {lesson.steps.map((s, i) => (
                <button
                  key={s.label}
                  className="learn-step"
                  aria-pressed={i === stepIndex}
                  onClick={() => setStepIndex(i)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="learn-body">
          {step.army && <Army />}
          {step.directions && <Directions directions={step.directions} side={side} />}
          {step.promotionRow && <PromotionRow side={side} />}
          <div className="learn-words">
            <p className="learn-line">{step.line}</p>
            {step.note && <p className="learn-note">{step.note}</p>}
          </div>
        </div>
        <div className="learn-foot">
          {!noBoard && practice.focus && (
            <p
              className="learn-count"
              data-testid="learn-count"
              data-count={count}
              aria-live="polite"
            >
              <b>{count}</b> {count === 1 ? 'move' : 'moves'}
              {!practice.lastMove && <span className="learn-hint"> · tap a ring</span>}
            </p>
          )}
          {practice.lastMove && (
            <button className="learn-again" onClick={startOver}>
              Reset
            </button>
          )}
          <button className="learn-next" onClick={goNext} aria-label={`Next: ${nextLabel}`}>
            {nextLabel} <span aria-hidden>→</span>
          </button>
        </div>
      </section>
      {promotion && (
        <PromotionPicker
          choices={promotion}
          color={practice.side}
          onPick={(move) => {
            setPromotion(null);
            play(move);
          }}
          onCancel={() => setPromotion(null)}
        />
      )}
    </main>
  );
};

/** Whether the card stands beside the tower in this window (learnLayout.ts), following a resize. */
function useCardBeside(): boolean {
  const read = () => cardBeside(window.innerWidth, window.innerHeight);
  const [beside, setBeside] = React.useState(read);
  React.useEffect(() => {
    const update = () => setBeside(read());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return beside;
}

export default LearnScreen;
