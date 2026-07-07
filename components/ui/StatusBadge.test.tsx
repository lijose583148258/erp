import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders high-risk status with semantic evidence', () => {
    render(<StatusBadge status="overdue" />);

    const badge = screen.getByText('已逾期');
    expect(badge).toHaveAttribute('data-status', 'overdue');
    expect(badge).toHaveAttribute('data-risk', 'high');
    expect(badge).toHaveAccessibleName('状态：已逾期');
    expect(badge.className).toContain('ring-2');
  });

  it('uses custom labels without dropping caller class names', () => {
    render(<StatusBadge status="approved" label="Paid" className="extra-class" />);

    const badge = screen.getByText('Paid');
    expect(badge).toHaveAttribute('data-status', 'approved');
    expect(badge).toHaveClass('extra-class');
  });
});
