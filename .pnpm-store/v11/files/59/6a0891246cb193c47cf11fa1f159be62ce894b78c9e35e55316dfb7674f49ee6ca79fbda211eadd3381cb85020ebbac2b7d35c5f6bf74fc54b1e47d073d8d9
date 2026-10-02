import { UsageCostBreakdown } from '@tanstack/ai';
export interface ExtractedCost {
    cost?: number;
    costDetails?: UsageCostBreakdown;
}
/**
 * Extract `cost`/`costDetails` from a provider usage object.
 *
 * - `cost` is attached only when it is a finite number — this preserves `cost === 0`
 *   and rejects `NaN`/`Infinity`, and does not clamp negative values.
 * - `costDetails` is attached only alongside a valid `cost` (an orphan breakdown
 *   without a total cannot be reconciled and is dropped). Both camelCase
 *   `costDetails` and snake_case `cost_details` are read.
 *
 * Returns an empty object when no usable cost is present, so call sites can spread
 * the result unconditionally.
 */
export declare function extractUsageCost(usage: unknown): ExtractedCost;
