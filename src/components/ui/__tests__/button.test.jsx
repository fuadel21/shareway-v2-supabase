import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '@/components/ui/button.jsx';
import React from 'react';

describe('Button', () => {
  it('renderiza contenido', () => {
    render(<Button>Hola</Button>);
    expect(screen.getByText('Hola')).toBeTruthy();
  });

  it('maneja click', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByText('Click'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
