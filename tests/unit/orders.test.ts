import { describe, expect, it } from 'vitest';

import { PreconditionFailedError } from '@/lib/api/errors';
import { OrderStatus } from '@/generated/prisma/enums';
import {
  allocateProportionally,
  allowedTransitions,
  assertTransition,
  canTransition,
} from '@/server/order-service';

/**
 * Order state machine and discount allocation.
 *
 * Both are pure, and both are places where a quiet bug costs money: an
 * allocation that does not sum back to the order discount puts the line totals
 * out of step with the invoice, and a missing transition guard lets a cancelled
 * order be shipped.
 */

describe('allocateProportionally', () => {
  it('splits evenly when the weights are equal', () => {
    expect(allocateProportionally(100, [50, 50])).toEqual([50, 50]);
  });

  it('allocates in proportion to the weights', () => {
    expect(allocateProportionally(300, [100, 200])).toEqual([100, 200]);
  });

  it('always sums back exactly to the total, even with awkward remainders', () => {
    const cases: { total: number; weights: number[] }[] = [
      { total: 100, weights: [33, 33, 34] },
      { total: 1, weights: [1, 1, 1] },
      { total: 999, weights: [100, 250, 333, 777] },
      { total: 5080, weights: [25400, 25400] },
      { total: 13, weights: [5, 7, 11, 13] },
      { total: 7, weights: [3, 3, 3] },
      { total: 1, weights: [999_99, 1] },
    ];

    for (const { total, weights } of cases) {
      const shares = allocateProportionally(total, weights);
      const sum = shares.reduce((running, share) => running + share, 0);
      expect(sum, `weights ${weights.join(',')} for total ${total}`).toBe(total);
    }
  });

  it('caps at the sum of the weights rather than over-allocating', () => {
    // Allocating more than the lines are worth has no correct answer; the
    // result is capped so no line ever exceeds its own value.
    const shares = allocateProportionally(10, [1, 2]);

    expect(shares).toEqual([1, 2]);
    expect(shares.reduce((running, share) => running + share, 0)).toBe(3);
  });

  it('never allocates more to a line than that line is worth', () => {
    const weights = [100, 5, 5];
    const shares = allocateProportionally(110, weights);

    shares.forEach((share, index) => {
      expect(share).toBeLessThanOrEqual(weights[index] as number);
    });
  });

  it('returns zeros for a zero or negative total', () => {
    expect(allocateProportionally(0, [10, 20])).toEqual([0, 0]);
    expect(allocateProportionally(-5, [10, 20])).toEqual([0, 0]);
  });

  it('returns zeros when every weight is zero, rather than dividing by zero', () => {
    expect(allocateProportionally(100, [0, 0])).toEqual([0, 0]);
  });

  it('gives the rounding remainder to the heaviest line', () => {
    // 10 across weights 10 and 20 is 3.33 / 6.67; floors are 3 and 6, and the
    // remaining 1 minor unit goes to the heavier line.
    expect(allocateProportionally(10, [10, 20])).toEqual([3, 7]);
  });
});

describe('order status transitions', () => {
  it('allows the normal forward path', () => {
    expect(canTransition(OrderStatus.PENDING, OrderStatus.CONFIRMED)).toBe(true);
    expect(canTransition(OrderStatus.CONFIRMED, OrderStatus.PROCESSING)).toBe(true);
    expect(canTransition(OrderStatus.PROCESSING, OrderStatus.SHIPPED)).toBe(true);
    expect(canTransition(OrderStatus.SHIPPED, OrderStatus.DELIVERED)).toBe(true);
  });

  it('treats a no-op transition as allowed', () => {
    expect(canTransition(OrderStatus.SHIPPED, OrderStatus.SHIPPED)).toBe(true);
  });

  it('refuses to run time backwards', () => {
    expect(canTransition(OrderStatus.SHIPPED, OrderStatus.PENDING)).toBe(false);
    expect(canTransition(OrderStatus.DELIVERED, OrderStatus.PROCESSING)).toBe(false);
    expect(canTransition(OrderStatus.PROCESSING, OrderStatus.CONFIRMED)).toBe(false);
  });

  it('treats cancelled and refunded as terminal', () => {
    for (const target of Object.values(OrderStatus)) {
      if (target === OrderStatus.CANCELLED) continue;
      expect(
        canTransition(OrderStatus.CANCELLED, target),
        `CANCELLED should not reach ${target}`,
      ).toBe(false);
    }

    for (const target of Object.values(OrderStatus)) {
      if (target === OrderStatus.REFUNDED) continue;
      expect(
        canTransition(OrderStatus.REFUNDED, target),
        `REFUNDED should not reach ${target}`,
      ).toBe(false);
    }
  });

  it('cannot cancel an order that has already shipped', () => {
    expect(canTransition(OrderStatus.SHIPPED, OrderStatus.CANCELLED)).toBe(false);
    expect(canTransition(OrderStatus.DELIVERED, OrderStatus.CANCELLED)).toBe(false);
  });

  it('allows refunding a delivered order', () => {
    expect(canTransition(OrderStatus.DELIVERED, OrderStatus.REFUNDED)).toBe(true);
  });

  it('throws a 412 with a helpful message on an illegal move', () => {
    try {
      assertTransition(OrderStatus.CANCELLED, OrderStatus.SHIPPED);
      expect.unreachable('assertTransition should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PreconditionFailedError);
      const failure = error as PreconditionFailedError;
      expect(failure.status).toBe(412);
      expect(failure.message).toContain('cancelled');
    }
  });

  it('lists the permitted moves when refusing', () => {
    try {
      assertTransition(OrderStatus.PENDING, OrderStatus.DELIVERED);
      expect.unreachable('assertTransition should have thrown');
    } catch (error) {
      expect((error as PreconditionFailedError).message).toContain('confirmed');
    }
  });
});

describe('allowedTransitions', () => {
  it('excludes cancel and refund, which have their own endpoints', () => {
    const fromPending = allowedTransitions(OrderStatus.PENDING);

    expect(fromPending).toContain(OrderStatus.CONFIRMED);
    expect(fromPending).not.toContain(OrderStatus.CANCELLED);
    expect(fromPending).not.toContain(OrderStatus.REFUNDED);
  });

  it('is empty for terminal states', () => {
    expect(allowedTransitions(OrderStatus.CANCELLED)).toEqual([]);
    expect(allowedTransitions(OrderStatus.REFUNDED)).toEqual([]);
  });

  it('only ever offers moves the state machine would accept', () => {
    for (const from of Object.values(OrderStatus)) {
      for (const to of allowedTransitions(from)) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(true);
      }
    }
  });
});
