import type { WarningRecord } from './omp.js';

export class SelfHealStore {
  private warnings = new Map<string, WarningRecord>();

  record(warning: Omit<WarningRecord, 'id' | 'ts' | 'fired'>): WarningRecord {
    const record: WarningRecord = {
      ...warning,
      id: crypto.randomUUID(),
      ts: Date.now(),
      fired: false,
    };
    this.warnings.set(record.id, record);
    return record;
  }

  unfired(): WarningRecord[] {
    const result: WarningRecord[] = [];
    for (const warning of this.warnings.values()) {
      if (!warning.fired) {
        result.push(warning);
      }
    }
    return result.sort((a, b) => a.ts - b.ts);
  }

  markFired(ids: ReadonlyArray<string>): void {
    for (const id of ids) {
      const warning = this.warnings.get(id);
      if (warning !== undefined) {
        warning.fired = true;
      }
    }
  }

  clear(): void {
    this.warnings.clear();
  }

  size(): number {
    return this.warnings.size;
  }
}
