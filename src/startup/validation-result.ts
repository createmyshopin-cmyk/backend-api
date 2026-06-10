export type ViolationSeverity = 'fatal' | 'warn';

export interface Violation {
  ruleId: string;
  severity: ViolationSeverity;
  message: string;
  remediation: string;
}

export interface ValidationResult {
  ok: boolean;
  violations: Violation[];
  warnings: Violation[];
}

export function mergeResults(...results: ValidationResult[]): ValidationResult {
  const violations: Violation[] = [];
  const warnings: Violation[] = [];
  for (const r of results) {
    violations.push(...r.violations);
    warnings.push(...r.warnings);
  }
  return {
    ok: violations.length === 0,
    violations,
    warnings,
  };
}

export function fatal(
  ruleId: string,
  message: string,
  remediation: string,
): Violation {
  return { ruleId, severity: 'fatal', message, remediation };
}

export function warn(
  ruleId: string,
  message: string,
  remediation: string,
): Violation {
  return { ruleId, severity: 'warn', message, remediation };
}
