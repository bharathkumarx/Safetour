import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App.jsx';
import { ApiError, shouldRetryRequest } from './lib/api.js';

describe('SafeTour placeholder', () => {
  it('shows the demo data badge', () => {
    render(<App />);
    expect(screen.getByText('Demo data')).toBeInTheDocument();
  });

  describe('API retry policy', () => {
    it('does not retry client, rate-limit, or validation failures', () => {
      expect(shouldRetryRequest(new ApiError('RATE_LIMITED', 'Too many requests', null, 429), 0)).toBe(false);
      expect(shouldRetryRequest(new ApiError('VALIDATION_ERROR', 'Invalid request', null, 422), 0)).toBe(false);
      expect(shouldRetryRequest(new ApiError('HTTP_ERROR', 'Bad request', null, 400), 0)).toBe(false);
    });

    it('allows at most two retries for transient failures', () => {
      expect(shouldRetryRequest(new Error('network down'), 0)).toBe(true);
      expect(shouldRetryRequest(new Error('network down'), 1)).toBe(true);
      expect(shouldRetryRequest(new Error('network down'), 2)).toBe(false);
    });
  });
});
