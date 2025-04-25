import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import App from './App';

test('renders the R3F canvas', () => {
  render(<App />);
  expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
});
