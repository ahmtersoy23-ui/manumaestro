/**
 * Skeleton Loading Component Tests
 * Tests for skeleton screen components
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  SkeletonCard,
  SkeletonTable,
  SkeletonList,
  SkeletonStats,
} from '@/components/loading/SkeletonCard';

describe('Skeleton Loading Components', () => {
  describe('SkeletonCard', () => {
    it('should render without crashing', () => {
      const { container } = render(<SkeletonCard />);
      expect(container.firstChild).toBeTruthy();
    });

    it('should have animate-pulse class for loading animation', () => {
      const { container } = render(<SkeletonCard />);
      expect(container.firstChild).toHaveClass('animate-pulse');
    });

    it('should render placeholder elements', () => {
      const { container } = render(<SkeletonCard />);
      const placeholders = container.querySelectorAll('.bg-gray-200, .bg-gray-300');
      expect(placeholders.length).toBeGreaterThan(0);
    });
  });

  describe('SkeletonTable', () => {
    it('should render without crashing', () => {
      const { container } = render(<SkeletonTable />);
      expect(container.firstChild).toBeTruthy();
    });

    it('should render header row placeholders', () => {
      const { container } = render(<SkeletonTable />);
      const header = container.querySelector('.bg-gray-50');
      expect(header).toBeTruthy();
    });

    it('should render multiple row placeholders', () => {
      const { container } = render(<SkeletonTable />);
      const rows = container.querySelectorAll('.border-b.border-gray-100');
      expect(rows.length).toBe(5);
    });
  });

  describe('SkeletonList', () => {
    it('should render without crashing', () => {
      const { container } = render(<SkeletonList />);
      expect(container.firstChild).toBeTruthy();
    });

    it('should render 8 list item placeholders', () => {
      const { container } = render(<SkeletonList />);
      const items = container.querySelectorAll('.animate-pulse');
      expect(items.length).toBe(8);
    });
  });

  describe('SkeletonStats', () => {
    it('should render without crashing', () => {
      const { container } = render(<SkeletonStats />);
      expect(container.firstChild).toBeTruthy();
    });

    it('should render 3 stat card placeholders', () => {
      const { container } = render(<SkeletonStats />);
      const cards = container.querySelectorAll('.animate-pulse');
      expect(cards.length).toBe(3);
    });

    it('should use grid layout', () => {
      const { container } = render(<SkeletonStats />);
      expect(container.firstChild).toHaveClass('grid');
    });
  });
});
