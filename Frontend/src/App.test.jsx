import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App.jsx';

describe('SafeTour placeholder', () => {
  it('shows the demo data badge', () => {
    render(<App />);
    expect(screen.getByText('Demo data')).toBeInTheDocument();
  });
});
