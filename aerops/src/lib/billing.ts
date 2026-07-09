/**
 * Flight billing — the single source of truth for how a closed flight turns
 * into money. Used by the dispatch close API (authoritative), the dispatch
 * UI (live estimate), and the seed. Pure and framework-free so it runs on
 * server and client alike and is trivially testable.
 */

/** Ground briefing/debriefing padding billed with dual instruction, in hours. */
export const BRIEF_DEBRIEF_HOURS = 0.5;

/** Round to one decimal — the granularity of hobbs meters and logbooks. */
export function roundHours(hours: number) {
  return Math.round(hours * 10) / 10;
}

/** Round to cents. */
export function roundMoney(amount: number) {
  return Math.round(amount * 100) / 100;
}

/** Billable flight time from hobbs readings. Throws if the window is invalid. */
export function flightTimeFromHobbs(hobbsOut: number, hobbsIn: number) {
  if (hobbsIn <= hobbsOut) {
    throw new RangeError(`Hobbs in (${hobbsIn.toFixed(1)}) must exceed hobbs out (${hobbsOut.toFixed(1)})`);
  }
  return roundHours(hobbsIn - hobbsOut);
}

export type FlightChargeInput = {
  flightTime: number;
  aircraftHourlyRate: number;
  /** Instructor hourly rate; omit or 0 for solo/rental flights. */
  instructorHourlyRate?: number;
  isDual: boolean;
};

export type FlightCharges = {
  aircraftCharge: number;
  instructorHours: number;
  instructorCharge: number;
  total: number;
};

export function computeFlightCharges({ flightTime, aircraftHourlyRate, instructorHourlyRate = 0, isDual }: FlightChargeInput): FlightCharges {
  const aircraftCharge = roundMoney(flightTime * aircraftHourlyRate);
  const instructorHours = isDual ? roundHours(flightTime + BRIEF_DEBRIEF_HOURS) : 0;
  const instructorCharge = roundMoney(instructorHours * instructorHourlyRate);
  return { aircraftCharge, instructorHours, instructorCharge, total: roundMoney(aircraftCharge + instructorCharge) };
}
