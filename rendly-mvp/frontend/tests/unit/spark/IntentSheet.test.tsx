import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('@/lib/api', () => ({ authFetch: jest.fn(), apiFetch: jest.fn() }));

const mockState: Record<string, unknown> = {};
jest.mock('@/components/spark/sheet/useIntentSheet', () => ({
  useIntentSheet: () => mockState,
}));
jest.mock('@/components/spark/sheet/SheetSummary', () => () => <div data-testid="summary" />);
jest.mock('@/components/spark/sheet/SheetSearchBar', () => (p: { query: string }) => (
  <input type="search" aria-label="Search intents" defaultValue={p.query} />
));
jest.mock('@/components/spark/sheet/SheetResultsGrid', () => () => <div data-testid="results" />);
jest.mock('@/components/spark/sheet/SheetTabs', () => ({
  __esModule: true,
  default: () => <div data-testid="tabs" />,
  SheetTabPanel: () => <div data-testid="tab-panel" />,
}));
jest.mock('@/components/spark/sheet/SheetMine', () => () => <div data-testid="mine" />);
jest.mock('@/components/spark/sheet/SheetPresets', () => () => <div data-testid="presets" />);
jest.mock('@/components/spark/sheet/SheetCustomAdd', () => () => <div data-testid="custom-add" />);

import IntentSheet from '@/components/spark/IntentSheet';

function setState(over: Record<string, unknown> = {}) {
  for (const k of Object.keys(mockState)) delete mockState[k];
  Object.assign(mockState, {
    selected: [],
    names: [],
    toggle: jest.fn(),
    add: jest.fn(),
    limitHit: false,
    maxReached: false,
    mine: [],
    mineState: 'ready',
    reloadMine: jest.fn(),
    heldNames: [],
    cost: 0,
    balance: 100,
    quotePending: false,
    summary: [],
    query: '',
    setQuery: jest.fn(),
    sort: 'trending',
    setSort: jest.fn(),
    results: [],
    searchState: 'idle',
    retrySearch: jest.fn(),
    pickIntent: jest.fn(),
    busyId: null,
    error: null,
    clearError: jest.fn(),
    ...over,
  });
}

function renderSheet(open = true) {
  const onClose = jest.fn();
  const onSpark = jest.fn();
  const utils = render(
    <IntentSheet open={open} mode="video" anonymous note="" onClose={onClose} onSpark={onSpark} />,
  );
  return { ...utils, onClose, onSpark };
}

beforeEach(() => setState());

describe('IntentSheet', () => {
  test('renders nothing when closed', () => {
    renderSheet(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('renders a labelled modal dialog when open', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog', { name: 'Choose your intents' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText(/Video · Anonymous/)).toBeInTheDocument();
  });

  test('Escape calls onClose', () => {
    const { onClose } = renderSheet();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Spark now is disabled with nothing selected', () => {
    const { onSpark } = renderSheet();
    const btn = screen.getByRole('button', { name: /Spark now/ });
    expect(btn).toBeDisabled();
    expect(screen.getByText('Pick at least one intent')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onSpark).not.toHaveBeenCalled();
  });

  test('Spark now sends the selected names', () => {
    setState({ names: ['ai'], selected: ['ai'], cost: 2 });
    const { onSpark } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /Spark now/ }));
    expect(onSpark).toHaveBeenCalledWith(['ai'], 1);
    expect(window.sessionStorage.getItem('rendly.spark.sheetSeen')).toBe('1');
  });

  test('Spark now is disabled when the cost exceeds the balance', () => {
    setState({ names: ['ai'], cost: 50, balance: 10 });
    renderSheet();
    expect(screen.getByRole('button', { name: /Spark now/ })).toBeDisabled();
    expect(screen.getByText('Not enough tokens')).toBeInTheDocument();
  });

  test('presets show while the query is empty and hide while searching', () => {
    const { unmount } = renderSheet();
    expect(screen.getByTestId('presets')).toBeInTheDocument();
    expect(screen.queryByTestId('results')).toBeNull();
    unmount();

    setState({ query: 'ai' });
    renderSheet();
    expect(screen.queryByTestId('presets')).toBeNull();
    expect(screen.getByTestId('results')).toBeInTheDocument();
  });

  test('shows the hook error with a dismiss button', () => {
    const clearError = jest.fn();
    setState({ error: 'Purchase failed', clearError });
    renderSheet();
    expect(screen.getByRole('alert')).toHaveTextContent('Purchase failed');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(clearError).toHaveBeenCalled();
  });
});
