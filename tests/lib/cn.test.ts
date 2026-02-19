/**
 * Tailwind CSS Class Utility Tests
 * Tests for cn() class merging utility
 */

import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils/cn';

describe('cn utility', () => {
  it('should merge simple class names', () => {
    const result = cn('px-4', 'py-2');
    expect(result).toBe('px-4 py-2');
  });

  it('should handle conditional classes', () => {
    const isActive = true;
    const result = cn('base-class', isActive && 'active-class');
    expect(result).toContain('base-class');
    expect(result).toContain('active-class');
  });

  it('should filter out falsy values', () => {
    const result = cn('base', false && 'hidden', undefined, null, 'visible');
    expect(result).toBe('base visible');
  });

  it('should merge conflicting Tailwind classes (last wins)', () => {
    const result = cn('px-2', 'px-4');
    expect(result).toBe('px-4');
  });

  it('should merge conflicting text color classes', () => {
    const result = cn('text-red-500', 'text-blue-500');
    expect(result).toBe('text-blue-500');
  });

  it('should handle empty inputs', () => {
    const result = cn();
    expect(result).toBe('');
  });

  it('should handle array of classes', () => {
    const result = cn(['px-4', 'py-2']);
    expect(result).toContain('px-4');
    expect(result).toContain('py-2');
  });

  it('should handle object syntax', () => {
    const result = cn({ 'bg-red-500': true, 'bg-blue-500': false });
    expect(result).toBe('bg-red-500');
  });

  it('should merge responsive variants correctly', () => {
    const result = cn('md:px-2', 'md:px-4');
    expect(result).toBe('md:px-4');
  });
});
