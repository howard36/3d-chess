import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PieceType } from '../engine/pieces';
import PromotionPicker from './PromotionPicker';

it('cancels with Escape after a click on the card itself, off its buttons', async () => {
  const onCancel = vi.fn();
  const from = { x: 0, y: 3, z: 3 };
  const to = { x: 0, y: 4, z: 4 };
  render(
    <PromotionPicker
      choices={[PieceType.Queen, PieceType.Knight].map((promotion) => ({ from, to, promotion }))}
      color="white"
      onPick={() => {}}
      onCancel={onCancel}
    />,
  );
  // A click on its words would leave the focus on the page, out of Escape's reach
  await userEvent.click(screen.getByRole('heading', { name: 'Promote to' }));
  await userEvent.keyboard('{Escape}');
  expect(onCancel).toHaveBeenCalledOnce();
});
