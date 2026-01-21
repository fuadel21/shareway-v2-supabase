
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { Card, CardContent } from '../ui/card';

describe('Card Debug', () => {
  it('renders Card correctly', () => {
    render(
      <Card data-testid="test-card">
        <CardContent>Test Content</CardContent>
      </Card>
    );
    expect(screen.getByTestId('test-card')).toBeInTheDocument();
    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });
});
