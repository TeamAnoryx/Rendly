import React from 'react';
import { act, render, screen } from '@testing-library/react';
import RouteTransition from '../RouteTransition';

jest.mock('next/navigation', () => ({ usePathname: () => '/' }));

test('the loader appears for a link whose click handler calls preventDefault (next/link)', () => {
  render(
    <>
      <RouteTransition />
      <a href="/login" onClick={(e) => e.preventDefault()}>
        Log in
      </a>
    </>,
  );
  act(() => {
    screen.getByText('Log in').click();
  });
  expect(document.querySelector('[role="status"], [aria-busy="true"]')).not.toBeNull();
});
