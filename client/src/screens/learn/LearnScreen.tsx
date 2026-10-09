import React from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { lazyChunk } from '../../lib/cachedImport';
import { ChunkBoundary } from '../../components/ChunkBoundary';
import { LESSONS, lessonById, practise, reachable, startPractice } from '../../game/lessons';
import type { Lesson } from '../../game/lessons';
import type { Move } from '../../engine';
import { PieceGlyph } from '../PieceGlyph';
import PromotionPicker from '../PromotionPicker';
import { Army, Directions, LevelsIcon, PromotionRow } from './Directions';
import { cardBeside } from './learnLayout';
import { backToGame } from './learnBack';
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
 * lands), and the lesson's few words in a card at the bottom. Opened from a
 * game, its way out (Home, and the last Next) leads back to that game.
 */
const LearnScreen = () => {
  const { lesson: id } = useParams<{ lesson?: string }>();
  const { state } = useLocation();
  const lesson = id === undefined ? LESSONS[0] : lessonById(id);
  if (!lesson) return <Navigate to="/learn" replace state={state} />;
  return <LessonView lesson={lesson} back={backToGame(state)} />;
};

const LessonView = ({ lesson, back }: { lesson: Lesson; back: string | null }) => {
  const routerNavigate = useNavigate();
  // From lesson to lesson the game to go back to goes along
  const navigate = (to: string, options: { replace?: boolean } = {}) =>
    routerNavigate(to, back ? { ...options, state: { back } } : options);
  const leave = () => routerNavigate(back ?? '/');
  // The lesson's step and the position the player is trying moves in, set
  // afresh for each lesson, each step and each start over (a fresh board,
  // epoch: it plays only the moves made after it mounts). Reset while
  // rendering, so no frame shows the last lesson's position under this one's
  // words.
  const begin = (stepIndex: number, epoch: number) => ({
    lesson: lesson.id,
    stepIndex,
    epoch,
    practice: startPractice(lesson.steps[stepIndex]),
  });
  const [run, setRun] = React.useState(() => begin(0, 0));
  if (run.lesson !== lesson.id) setRun(begin(0, run.epoch + 1));
  const current = run.lesson === lesson.id;
  const stepIndex = current ? run.stepIndex : 0;
  const step = lesson.steps[stepIndex];
  const practice = current ? run.practice : startPractice(step);
  const setStepIndex = (i: number) => setRun(begin(i, run.epoch + 1));
  const startOver = () => setRun(begin(stepIndex, run.epoch + 1));
  const play = (move: Move) => setRun((r) => ({ ...r, practice: practise(r.practice, move) }));
  const [promotion, setPromotion] = React.useState<Move[] | null>(null);

  const index = LESSONS.indexOf(lesson);
  const nextLesson = LESSONS[index + 1];
  const lastStep = stepIndex >= lesson.steps.length - 1;
  const goNext = () => {
    if (!lastStep) setStepIndex(stepIndex + 1);
    else if (nextLesson) navigate(lessonPath(nextLesson));
    else routerNavigate(back ?? '/new');
  };
  const nextLabel = !lastStep
    ? lesson.steps[stepIndex + 1].label
    : nextLesson
      ? nextLesson.name
      : back
        ? 'Back to game'
        : 'Play a game';

  const [noBoard, setNoBoard] = React.useState(false);
  const beside = useCardBeside();
  const LearnCanvas = learnCanvas.Component;
  const count = reachable(practice);

  return (
    <main className="learn" data-testid="learn" data-card={beside ? 'beside' : 'below'}>
      <div className="learn-stage">
        <ChunkBoundary canvas onFail={() => setNoBoard(true)}>
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
        <button className="lobby-link" onClick={leave}>
          <span aria-hidden>←</span> {back ? 'Game' : 'Home'}
        </button>
      </header>
      <section
        className="learn-card hud-glass"
        aria-labelledby="learn-title"
        data-lesson={lesson.id}
        data-steps={lesson.steps.length > 1 || undefined}
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
          {lesson.steps.length > 1 && (
            <>
              <span className="learn-step-name">{step.label}</span>
              {/* The lesson's steps, a dot each, the current one long */}
              <div className="learn-steps" role="group" aria-label={`${lesson.name} lessons`}>
                {lesson.steps.map((s, i) => (
                  <button
                    key={s.label}
                    className="learn-step"
                    aria-label={s.label}
                    title={s.label}
                    aria-current={i === stepIndex ? 'step' : undefined}
                    onClick={() => setStepIndex(i)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
        <div className="learn-body">
          {step.army && <Army />}
          {step.directions && <Directions directions={step.directions} />}
          {step.promotionRow && <PromotionRow />}
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
