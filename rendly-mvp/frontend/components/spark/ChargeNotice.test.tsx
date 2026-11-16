import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import ChargeNotice, { ChargeChip, markChargeNoticeSeen, shouldShowChargeNotice } from './ChargeNotice';

const COPY =
  'Free for the first 30 seconds: skip before then and neither of you pays. After that you both pay, only for intents you share.';

describe('ChargeNotice', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('renders the copy and countdown when open', () => {
    const onDismiss = jest.fn();
    render(<ChargeNotice open secondsLeft={24.2} progress={0.2} onDismiss={onDismiss} />);
    expect(screen.getByText(COPY)).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', () => {
    render(<ChargeNotice open={false} secondsLeft={30} progress={0} onDismiss={() => undefined} />);
    expect(screen.queryByText(COPY)).not.toBeInTheDocument();
  });

  it('tracks whether the notice was seen this session', () => {
    expect(shouldShowChargeNotice()).toBe(true);
    markChargeNoticeSeen();
    expect(shouldShowChargeNotice()).toBe(false);
    expect(window.sessionStorage.getItem('rendly.spark.chargeNoticeSeen')).not.toBeNull();
  });
});

describe('ChargeChip', () => {
  it('shows the free countdown while pending', () => {
    render(<ChargeChip state="pending" secondsLeft={12.3} cost={10} />);
    expect(screen.getByText('Free for 13s')).toBeInTheDocument();
  });

  it('shows settling instead of a stuck zero once the window is over', () => {
    render(<ChargeChip state="pending" secondsLeft={0} cost={10} />);
    expect(screen.getByText('Settling…')).toBeInTheDocument();
    expect(screen.queryByText('Free for 0s')).not.toBeInTheDocument();
  });

  it('shows the charged amount', () => {
    render(<ChargeChip state="charged" secondsLeft={0} cost={10} />);
    expect(screen.getByText('Charged 10 tokens')).toBeInTheDocument();
  });

  it('shows not charged when waived', () => {
    const { container } = render(<ChargeChip state="waived" secondsLeft={0} cost={10} className="x" />);
    expect(screen.getByText('Not charged')).toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute('title');
    expect(container.firstChild).toHaveClass('cn-chip', 'cn-chip--waived', 'x');
  });
});
