import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import PersonMenu, { PersonMenuTrigger, type PersonMenuItem } from './PersonMenu';
import PermissionPrompt, { PERMISSION_PROMPT_MS } from './PermissionPrompt';

const item = (over: Partial<PersonMenuItem>): PersonMenuItem => ({
  key: 'k',
  label: 'Mute',
  icon: null,
  onSelect: jest.fn(),
  ...over,
});

describe('PersonMenu', () => {
  test('shows nothing while closed and the items once opened', () => {
    const { rerender } = render(<PersonMenu open={false} items={[item({})]} />);
    expect(screen.queryByRole('menuitem')).toBeNull();
    rerender(<PersonMenu open items={[item({})]} />);
    expect(screen.getByRole('menuitem', { name: /mute/i })).toBeTruthy();
  });

  test('a locked item (feature off for this huddle) cannot be selected', () => {
    const onSelect = jest.fn();
    render(<PersonMenu open items={[item({ key: 'reward', label: 'Reward tokens', locked: true, onSelect })]} />);
    const btn = screen.getByRole('menuitem', { name: /reward tokens/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('an unlocked item runs its action', () => {
    const onSelect = jest.fn();
    render(<PersonMenu open items={[item({ onSelect })]} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /mute/i }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  test('the trigger reports whether the menu is open', () => {
    render(<PersonMenuTrigger open onToggle={jest.fn()} label="Asha" />);
    expect(screen.getByRole('button', { name: /actions for asha/i }).getAttribute('aria-expanded')).toBe('true');
  });
});

describe('PermissionPrompt', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('closes itself after 3 seconds', () => {
    const onClose = jest.fn();
    render(<PermissionPrompt message="The host has given you permission to share your screen." onClose={onClose} />);
    expect(screen.getByText(/permission to share your screen/i)).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(PERMISSION_PROMPT_MS - 1);
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('the × button closes it at once', () => {
    const onClose = jest.fn();
    render(<PermissionPrompt message="Granted" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
