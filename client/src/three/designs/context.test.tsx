import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import classic from './classic';
import type { Design, DesignEntry } from './types';

// Real design modules paint textures on a canvas at import, which jsdom
// lacks: the registry is replaced by two cheap stand-ins.
const fake = (id: string, name: string): Design => ({ ...classic, id, name });
const loadNeon = vi.fn(async () => ({ default: fake('neon', 'Neon') }));
vi.mock('./registry', () => ({
  DESIGNS: [
    {
      id: 'classic',
      name: 'Classic',
      blurb: 'The original.',
      swatch: ['#000', '#fff', '#000', '#0ff'],
      load: async () => ({ default: classic }),
    },
    {
      id: 'neon',
      name: 'Neon',
      blurb: 'Glowing.',
      swatch: ['#000', '#0ff', '#f0f', '#ff0'],
      load: () => loadNeon(),
    },
  ] satisfies DesignEntry[],
}));

const { DesignChoiceProvider, useDesignChoice, useDesign } = await import('./context');
const { default: DesignPicker } = await import('../../screens/DesignPicker');

const Show = () => {
  const { id, design } = useDesignChoice();
  return (
    <p>
      chosen:{id} drawn:{design.id}
    </p>
  );
};

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  loadNeon.mockClear();
});
afterEach(() => window.history.replaceState({}, '', '/'));

describe('design choice', () => {
  it('is classic with no provider, and by default', () => {
    const Bare = () => <p>{useDesign().id}</p>;
    render(<Bare />);
    expect(screen.getByText('classic')).toBeInTheDocument();
    render(
      <DesignChoiceProvider>
        <Show />
      </DesignChoiceProvider>,
    );
    expect(screen.getByText('chosen:classic drawn:classic')).toBeInTheDocument();
  });

  it('opens with ?design= and remembers it, loading the module once', async () => {
    window.history.replaceState({}, '', '/game/ABC?design=neon');
    render(
      <DesignChoiceProvider>
        <Show />
      </DesignChoiceProvider>,
    );
    // Drawn in the previous design until the chunk arrives
    expect(screen.getByText('chosen:neon drawn:classic')).toBeInTheDocument();
    await screen.findByText('chosen:neon drawn:neon');
    expect(localStorage.getItem('3dchess.design')).toBe('neon');
    expect(loadNeon).toHaveBeenCalledTimes(1);
  });

  it('falls back to the remembered design, and ignores unknown ids', async () => {
    localStorage.setItem('3dchess.design', 'neon');
    window.history.replaceState({}, '', '/?design=nope');
    render(
      <DesignChoiceProvider>
        <Show />
      </DesignChoiceProvider>,
    );
    await screen.findByText('chosen:neon drawn:neon');
  });

  it('switches from the picker and keeps the choice', async () => {
    const user = userEvent.setup();
    render(
      <DesignChoiceProvider>
        <DesignPicker />
        <Show />
      </DesignChoiceProvider>,
    );
    const button = screen.getByRole('button', { name: 'Board style: Classic' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: /Neon/ }));
    await screen.findByText('chosen:neon drawn:neon');
    expect(screen.getByRole('button', { name: 'Board style: Neon' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(localStorage.getItem('3dchess.design')).toBe('neon');
  });

  it('closes the picker on Escape without changing the design', async () => {
    const user = userEvent.setup();
    render(
      <DesignChoiceProvider>
        <DesignPicker />
        <Show />
      </DesignChoiceProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Board style: Classic' }));
    expect(screen.getByRole('list', { name: 'Board styles' })).toBeInTheDocument();
    await act(async () => {
      await user.keyboard('{Escape}');
    });
    await waitFor(() => expect(screen.queryByRole('list')).not.toBeInTheDocument());
    expect(screen.getByText('chosen:classic drawn:classic')).toBeInTheDocument();
  });
});
