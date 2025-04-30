import React from 'react';
import { render } from '@testing-library/react';
import { PieceMesh } from './PieceMesh';
import { PieceType } from '../engine';
import '@testing-library/jest-dom';

const types = [
  PieceType.Pawn,
  PieceType.Rook,
  PieceType.Bishop,
  PieceType.Knight,
  PieceType.Unicorn,
  PieceType.Queen,
  PieceType.King,
];

describe('PieceMesh', () => {
  types.forEach((type) => {
    ['white', 'black'].forEach((color) => {
      it(`renders ${color} ${type} and matches snapshot`, () => {
        const { container } = render(<PieceMesh type={type} color={color as 'white' | 'black'} />);
        expect(container).toMatchSnapshot();
      });
    });
  });
});
