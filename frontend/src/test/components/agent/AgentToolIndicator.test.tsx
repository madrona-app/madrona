import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentToolIndicator } from '../../../components/agent/AgentToolIndicator';

describe('AgentToolIndicator', () => {
  it('renders the friendly label for known tools', () => {
    render(<AgentToolIndicator toolName="search_collection" />);
    expect(screen.getByText('Searching collection...')).toBeInTheDocument();
  });

  it('renders "Looking up object..." for get_object_detail', () => {
    render(<AgentToolIndicator toolName="get_object_detail" />);
    expect(screen.getByText('Looking up object...')).toBeInTheDocument();
  });

  it('renders "Checking exhibitions..." for list_current_exhibitions', () => {
    render(<AgentToolIndicator toolName="list_current_exhibitions" />);
    expect(screen.getByText('Checking exhibitions...')).toBeInTheDocument();
  });

  it('renders "Loading exhibition..." for get_exhibition_info', () => {
    render(<AgentToolIndicator toolName="get_exhibition_info" />);
    expect(screen.getByText('Loading exhibition...')).toBeInTheDocument();
  });

  it('falls back to "Working..." for unknown tools', () => {
    render(<AgentToolIndicator toolName="some_unknown_tool" />);
    expect(screen.getByText('Working...')).toBeInTheDocument();
  });

  it('renders the pulsing indicator dot', () => {
    const { container } = render(<AgentToolIndicator toolName="search_collection" />);
    const dot = container.querySelector('.animate-pulse');
    expect(dot).toBeTruthy();
    expect(dot?.className).toContain('bg-bark');
  });

  it('renders italic styling for the text container', () => {
    const { container } = render(<AgentToolIndicator toolName="search_collection" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('italic');
  });

  describe('delegate_to_specialist', () => {
    it('renders "Asking the registrar..." with specialist name', () => {
      render(
        <AgentToolIndicator
          toolName="delegate_to_specialist"
          specialist="registrar"
        />,
      );
      expect(screen.getByText('Asking the registrar...')).toBeInTheDocument();
    });

    it('humanizes loans_registrar to "loans registrar"', () => {
      render(
        <AgentToolIndicator
          toolName="delegate_to_specialist"
          specialist="loans_registrar"
        />,
      );
      expect(screen.getByText('Asking the loans registrar...')).toBeInTheDocument();
    });

    it('humanizes rights_specialist to "rights specialist"', () => {
      render(
        <AgentToolIndicator
          toolName="delegate_to_specialist"
          specialist="rights_specialist"
        />,
      );
      expect(screen.getByText('Asking the rights specialist...')).toBeInTheDocument();
    });

    it('falls back to generic "Asking the specialist..." with no specialist arg', () => {
      render(<AgentToolIndicator toolName="delegate_to_specialist" />);
      expect(screen.getByText('Asking the specialist...')).toBeInTheDocument();
    });
  });
});
