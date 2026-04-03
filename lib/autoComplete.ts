/**
 * Auto-complete from snapshot — DEPRECATED
 *
 * Status management is now fully handled by waterfallComplete().
 * This function is kept as a no-op for backward compatibility
 * (called from snapshot generation).
 *
 * waterfallComplete uses combined view: snapshotStock + producedQuantity
 * to set status per marketplace request by priority.
 */

export async function autoCompleteFromSnapshot(_month: string): Promise<number> {
  // No-op: waterfall handles all status management
  return 0;
}
