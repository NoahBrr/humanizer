/**
 * Checkride readiness — a transparent, factor-by-factor score (0–100).
 * Every factor explains itself so a CFI can see WHY, not just a number.
 * (The future AI layer refines the weights; the factors stay the same.)
 */
export type ReadinessFactor = { label: string; met: boolean; detail: string; weight: number };
export type Readiness = {
  score: number;
  status: "NOT_READY" | "NEEDS_WORK" | "ALMOST_READY" | "READY" | "SCHEDULED";
  factors: ReadinessFactor[];
  weakAreas: string[];
};

export function computeReadiness(input: {
  totalHours: number;
  requiredHours: number;
  lessonsCompleted: number;
  lessonsTotal: number;
  stageChecksPassed: number;
  stageChecksTotal: number;
  endorsementCount: number;
  medicalValid: boolean;
  writtenTestPassed: boolean | null;
  checkrideScheduled: boolean;
  weakAreas: string[];
}): Readiness {
  const pct = (n: number, d: number) => (d > 0 ? Math.min(1, n / d) : 0);

  const factors: ReadinessFactor[] = [
    {
      label: "Flight hours",
      met: input.totalHours >= input.requiredHours,
      detail: `${input.totalHours.toFixed(1)} of ${input.requiredHours.toFixed(0)} required`,
      weight: 30 * pct(input.totalHours, input.requiredHours),
    },
    {
      label: "Syllabus lessons",
      met: input.lessonsTotal > 0 && input.lessonsCompleted >= input.lessonsTotal,
      detail: `${input.lessonsCompleted} of ${input.lessonsTotal} complete`,
      weight: 25 * pct(input.lessonsCompleted, input.lessonsTotal),
    },
    {
      label: "Stage checks",
      met: input.stageChecksTotal > 0 && input.stageChecksPassed >= input.stageChecksTotal,
      detail: `${input.stageChecksPassed} of ${input.stageChecksTotal} passed`,
      weight: 15 * pct(input.stageChecksPassed, input.stageChecksTotal),
    },
    {
      label: "Endorsements",
      met: input.endorsementCount >= 2,
      detail: `${input.endorsementCount} on file`,
      weight: 10 * pct(input.endorsementCount, 2),
    },
    {
      label: "Knowledge test",
      met: input.writtenTestPassed === true,
      detail: input.writtenTestPassed === true ? "Passed" : input.writtenTestPassed === false ? "Not yet passed" : "Not recorded",
      weight: input.writtenTestPassed ? 10 : 0,
    },
    {
      label: "Medical certificate",
      met: input.medicalValid,
      detail: input.medicalValid ? "Current" : "Expired or missing",
      weight: input.medicalValid ? 10 : 0,
    },
  ];

  const score = Math.round(factors.reduce((t, f) => t + f.weight, 0));
  const status = input.checkrideScheduled
    ? "SCHEDULED"
    : score >= 90 ? "READY" : score >= 70 ? "ALMOST_READY" : score >= 40 ? "NEEDS_WORK" : "NOT_READY";

  return { score, status, factors, weakAreas: input.weakAreas.slice(0, 4) };
}
