import { Prisma } from "@prisma/client";

/**
 * Tax computation (doc 07). The INTERNAL TaxCalculator seam: per-line
 * taxability, org/location-scoped rules, stacked rates (state + local),
 * configurable rounding. Pure and Decimal — AeroOps never derives jurisdiction
 * or guarantees legal treatment; the org configures rules and confirms them.
 * Snapshots (TaxSnapshot) are written at approval — Phase 3; this is the math.
 */

export type TaxRoundingMode = "HALF_UP" | "HALF_EVEN";
export type TaxRoundingLevel = "PER_RULE_TOTAL" | "PER_LINE";

export type TaxableLine = {
  lineId: string;
  amount: Prisma.Decimal; // the taxable base for this line
  chargeClass: string; // e.g. "aircraft_rental" | "instruction" | "airport_fee"
  taxable: boolean;
};

export type TaxRuleInput = {
  id: string;
  ruleKey: string;
  version: number;
  name: string;
  jurisdictionLabel: string;
  ratePercent: Prisma.Decimal; // 6.0000 = 6%
  appliesToKinds: string[]; // charge-class keys; empty = applies to all taxable classes
};

export type TaxLineResult = { lineId: string; ruleId: string; ruleKey: string; base: Prisma.Decimal; ratePercent: Prisma.Decimal; tax: Prisma.Decimal };
export type TaxComputation = {
  lines: TaxLineResult[];
  perRule: { ruleId: string; ruleKey: string; jurisdictionLabel: string; base: Prisma.Decimal; tax: Prisma.Decimal }[];
  totalTax: Prisma.Decimal;
  taxableBase: Prisma.Decimal;
};

const ROUND = { HALF_UP: Prisma.Decimal.ROUND_HALF_UP, HALF_EVEN: Prisma.Decimal.ROUND_HALF_EVEN } as const;

function ruleApplies(rule: TaxRuleInput, line: TaxableLine): boolean {
  if (!line.taxable) return false;
  if (rule.appliesToKinds.length === 0) return true;
  return rule.appliesToKinds.includes(line.chargeClass);
}

/**
 * Compute tax over the taxable lines with the active rules. Rules stack: every
 * applicable rule contributes its own tax on the same base (state + local both
 * apply). Rounding level decides whether each line×rule rounds individually
 * (PER_LINE) or the rule's aggregate base rounds once (PER_RULE_TOTAL).
 */
export function computeTax(
  lines: TaxableLine[],
  rules: TaxRuleInput[],
  opts: { mode: TaxRoundingMode; level: TaxRoundingLevel } = { mode: "HALF_UP", level: "PER_RULE_TOTAL" },
): TaxComputation {
  const rounding = ROUND[opts.mode];
  const Z = new Prisma.Decimal(0);
  const lineResults: TaxLineResult[] = [];
  const perRule: TaxComputation["perRule"] = [];
  let totalTax = Z;

  const taxableBase = lines.filter((l) => l.taxable).reduce((t, l) => t.plus(l.amount), Z);

  for (const rule of rules) {
    const applicable = lines.filter((l) => ruleApplies(rule, l));
    if (applicable.length === 0) continue;
    const factor = rule.ratePercent.dividedBy(100);
    let ruleBase = Z;
    let ruleTax = Z;

    if (opts.level === "PER_LINE") {
      for (const l of applicable) {
        const tax = l.amount.times(factor).toDecimalPlaces(2, rounding);
        lineResults.push({ lineId: l.lineId, ruleId: rule.id, ruleKey: rule.ruleKey, base: l.amount, ratePercent: rule.ratePercent, tax });
        ruleBase = ruleBase.plus(l.amount);
        ruleTax = ruleTax.plus(tax);
      }
    } else {
      ruleBase = applicable.reduce((t, l) => t.plus(l.amount), Z);
      ruleTax = ruleBase.times(factor).toDecimalPlaces(2, rounding);
      // Attribute the rounded rule tax back proportionally for line-level records.
      for (const l of applicable) {
        const share = ruleBase.isZero() ? Z : l.amount.times(ruleTax).dividedBy(ruleBase).toDecimalPlaces(2, rounding);
        lineResults.push({ lineId: l.lineId, ruleId: rule.id, ruleKey: rule.ruleKey, base: l.amount, ratePercent: rule.ratePercent, tax: share });
      }
    }

    perRule.push({ ruleId: rule.id, ruleKey: rule.ruleKey, jurisdictionLabel: rule.jurisdictionLabel, base: ruleBase, tax: ruleTax });
    totalTax = totalTax.plus(ruleTax);
  }

  return { lines: lineResults, perRule, totalTax, taxableBase };
}
