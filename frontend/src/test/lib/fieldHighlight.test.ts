import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  navigateToSection,
  findFieldElement,
  highlightField,
  clearAllHighlights,
  FIELD_HIGHLIGHT_CSS,
} from '../../lib/fieldHighlight';

describe('fieldHighlight', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('FIELD_HIGHLIGHT_CSS', () => {
    it('exports a non-empty CSS string', () => {
      expect(typeof FIELD_HIGHLIGHT_CSS).toBe('string');
      expect(FIELD_HIGHLIGHT_CSS.length).toBeGreaterThan(0);
    });

    it('defines the highlight class', () => {
      expect(FIELD_HIGHLIGHT_CSS).toContain('field-highlight-missing');
    });

    it('defines a keyframe animation', () => {
      expect(FIELD_HIGHLIGHT_CSS).toContain('@keyframes fieldHighlightPulse');
    });
  });

  describe('findFieldElement', () => {
    it('finds element by data-field attribute', () => {
      const div = document.createElement('div');
      div.setAttribute('data-field', 'depositor_name');
      document.body.appendChild(div);

      const result = findFieldElement('depositor_name');
      expect(result).toBe(div);
    });

    it('finds element by #field- prefix id', () => {
      const div = document.createElement('div');
      div.id = 'field-foo';
      document.body.appendChild(div);

      const result = findFieldElement('foo');
      expect(result).toBe(div);
    });

    it('finds element by name attribute', () => {
      const input = document.createElement('input');
      input.setAttribute('name', 'my_input');
      document.body.appendChild(input);

      const result = findFieldElement('my_input');
      expect(result).toBe(input);
    });

    it('handles dotted field paths by converting to dashes', () => {
      const div = document.createElement('div');
      div.id = 'field-meta-version';
      document.body.appendChild(div);

      const result = findFieldElement('meta.version');
      expect(result).toBe(div);
    });

    it('returns null when no match found', () => {
      const result = findFieldElement('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('highlightField', () => {
    it('adds highlight class to input element', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);

      highlightField(input, 1000);
      expect(input.classList.contains('field-highlight-missing')).toBe(true);
    });

    it('adds inline helper text when provided', () => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-field', 'foo');
      const input = document.createElement('input');
      wrapper.appendChild(input);
      document.body.appendChild(wrapper);

      highlightField(input, 1000, 'Required field');

      const helper = wrapper.querySelector('.field-helper-required');
      expect(helper).not.toBeNull();
      expect(helper?.textContent).toBe('Required field');
    });

    it('removes highlight class after duration elapses', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);

      highlightField(input, 500);
      expect(input.classList.contains('field-highlight-missing')).toBe(true);

      vi.advanceTimersByTime(500);
      expect(input.classList.contains('field-highlight-missing')).toBe(false);
    });

    it('removes existing helper before adding new one', () => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-field', 'foo');
      const input = document.createElement('input');
      wrapper.appendChild(input);
      document.body.appendChild(wrapper);

      highlightField(input, 5000, 'First');
      highlightField(input, 5000, 'Second');

      const helpers = wrapper.querySelectorAll('.field-helper-required');
      expect(helpers).toHaveLength(1);
      expect(helpers[0].textContent).toBe('Second');
    });

    it('finds nested input within wrapper element', () => {
      const wrapper = document.createElement('div');
      const input = document.createElement('input');
      wrapper.appendChild(input);
      document.body.appendChild(wrapper);

      highlightField(wrapper, 1000);
      expect(input.classList.contains('field-highlight-missing')).toBe(true);
    });
  });

  describe('clearAllHighlights', () => {
    it('removes the highlight class from all matching elements', () => {
      const a = document.createElement('input');
      a.classList.add('field-highlight-missing');
      const b = document.createElement('input');
      b.classList.add('field-highlight-missing');
      document.body.append(a, b);

      clearAllHighlights();

      expect(a.classList.contains('field-highlight-missing')).toBe(false);
      expect(b.classList.contains('field-highlight-missing')).toBe(false);
    });

    it('is a no-op when there are no highlighted elements', () => {
      expect(() => clearAllHighlights()).not.toThrow();
    });
  });

  describe('navigateToSection', () => {
    it('calls expandSection callback if provided', () => {
      const expandSection = vi.fn();
      navigateToSection('mySection', undefined, { expandSection });
      expect(expandSection).toHaveBeenCalledWith('mySection');
    });

    it('scrolls to element with section- prefix id', () => {
      const section = document.createElement('div');
      section.id = 'section-mySection';
      const scrollSpy = vi.fn();
      section.scrollIntoView = scrollSpy;
      document.body.appendChild(section);

      navigateToSection('mySection');
      vi.advanceTimersByTime(150);

      expect(scrollSpy).toHaveBeenCalled();
    });

    it('falls back to bare section id when section- prefix not found', () => {
      const section = document.createElement('div');
      section.id = 'mySection';
      const scrollSpy = vi.fn();
      section.scrollIntoView = scrollSpy;
      document.body.appendChild(section);

      navigateToSection('mySection');
      vi.advanceTimersByTime(150);

      expect(scrollSpy).toHaveBeenCalled();
    });

    it('does nothing when section is not found', () => {
      // Should not throw
      expect(() => {
        navigateToSection('ghost');
        vi.advanceTimersByTime(150);
      }).not.toThrow();
    });

    it('highlights the field when fieldPath is provided', () => {
      const section = document.createElement('div');
      section.id = 'section-mySection';
      section.scrollIntoView = vi.fn();

      const input = document.createElement('input');
      input.setAttribute('name', 'myField');
      section.appendChild(input);
      document.body.appendChild(section);

      navigateToSection('mySection', 'myField', { highlightDuration: 1000 });
      vi.advanceTimersByTime(150);

      expect(input.classList.contains('field-highlight-missing')).toBe(true);
    });
  });
});
