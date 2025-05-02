import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

// test('renders the R3F canvas', () => {
//   render(<App />);
//   expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
// });

test('renders StartScreen for the default route', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>,
  );
  // Check for an element unique to StartScreen, like the button
  expect(screen.getByRole('button', { name: 'Start New Game' })).toBeInTheDocument();
});
