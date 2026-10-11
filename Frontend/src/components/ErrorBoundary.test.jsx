import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary.jsx';

const ThrowingChild = ({ shouldThrow }) => {
  if (shouldThrow) throw new Error('Test error from child');
  return <div data-testid="child">Child content</div>;
};

describe('ErrorBoundary', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('shows fallback when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Application Error')).toBeInTheDocument();
    expect(screen.getByText('Test error from child')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload app/i })).toBeInTheDocument();
  });
});