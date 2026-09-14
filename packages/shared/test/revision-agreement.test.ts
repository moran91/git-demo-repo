import { describe, expect, it } from 'vitest';
import { revisionAgreementReason, WEIGHT_OVER_TOLERANCE } from '../src/pricing.js';

/**
 * reviseOrder and the dashboard's revision dialog both ask "does this change need the customer's
 * phone agreement?". They were written separately and drifted: the dialog missed "quantity set to 0"
 * and "weight more than 25% over the request", so staff filled the form and got an opaque rejection.
 * Both now call this function, and these cases pin its answers.
 */
const unitLine = { quantity: 2, requestedGrams: undefined };
const weightLine = { quantity: 1, requestedGrams: 1000 };

describe('revisionAgreementReason', () => {
  it('always needs agreement to remove or substitute a line', () => {
    expect(revisionAgreementReason(unitLine, { action: 'remove' })).toBe('removal');
    expect(revisionAgreementReason(unitLine, { action: 'substitute' })).toBe('substitution');
  });

  it('treats a quantity of zero as a removal', () => {
    expect(revisionAgreementReason(unitLine, { action: 'set_quantity', quantity: 0 })).toBe('removal');
  });

  it('needs agreement to increase a quantity but not to reduce one', () => {
    expect(revisionAgreementReason(unitLine, { action: 'set_quantity', quantity: 3 })).toBe('increase');
    expect(revisionAgreementReason(unitLine, { action: 'set_quantity', quantity: 1 })).toBeNull();
    expect(revisionAgreementReason(unitLine, { action: 'set_quantity', quantity: 2 })).toBeNull();
  });

  it('allows weighing over by the tolerance, but not beyond it', () => {
    const limit = Math.ceil(1000 * WEIGHT_OVER_TOLERANCE); // 1250g
    expect(revisionAgreementReason(weightLine, { action: 'set_actual_weight', actualGrams: limit })).toBeNull();
    expect(revisionAgreementReason(weightLine, { action: 'set_actual_weight', actualGrams: limit + 1 })).toBe('increase');
    expect(revisionAgreementReason(weightLine, { action: 'set_actual_weight', actualGrams: 800 })).toBeNull();
  });

  it('is safe when the line cannot be found', () => {
    expect(revisionAgreementReason(undefined, { action: 'set_quantity', quantity: 1 })).toBe('increase');
    expect(revisionAgreementReason(undefined, { action: 'remove' })).toBe('removal');
  });
});
