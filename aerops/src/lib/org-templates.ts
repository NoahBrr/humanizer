/**
 * Organization templates for the Demo Data Generator (Founder Platform).
 * Client-safe: no Prisma or server imports. Plans reference the seeded
 * SubscriptionPlan rows by name; profiles use lib/business-profiles keys.
 */

export type PlanName = "Starter" | "Professional" | "Enterprise" | "University";

// --------------------------------------------------------------------------
// Templates
// --------------------------------------------------------------------------

export type OrgTemplateKey =
  | "small-flight-school"
  | "medium-flight-school"
  | "large-university"
  | "flying-club"
  | "corporate-flight-dept"
  | "fbo"
  | "charter-company"
  | "aircraft-management";

export type FleetMixEntry = {
  manufacturer: string; model: string; seats: number; engineType?: string;
  share: number; wet: [number, number]; sim?: boolean;
};

export type OrgTemplate = {
  key: OrgTemplateKey;
  label: string;
  description: string;
  exampleNames: string[];
  defaultFleetSize: number;
  /** students (or members/clients) per aircraft */
  peopleRatio: number;
  /** instructors per aircraft (0 disables training artifacts) */
  instructorRatio: number;
  /** average flights per aircraft per day */
  utilization: number;
  personaGoals: string[];
  fleetMix: FleetMixEntry[];
  plan: PlanName;
  businessProfiles: string[];
  training: boolean;
};

const TRAINER_MIX: FleetMixEntry[] = [
  { manufacturer: "Cessna", model: "172S Skyhawk", seats: 4, share: 0.5, wet: [165, 205] },
  { manufacturer: "Piper", model: "PA-28-181 Archer", seats: 4, share: 0.2, wet: [175, 210] },
  { manufacturer: "Diamond", model: "DA40 NG", seats: 4, share: 0.12, wet: [215, 255] },
  { manufacturer: "Cessna", model: "152", seats: 2, share: 0.08, wet: [125, 150] },
  { manufacturer: "Piper", model: "PA-44 Seminole", seats: 4, share: 0.05, wet: [320, 380] },
  { manufacturer: "Redbird", model: "FMX AATD", seats: 2, share: 0.05, wet: [85, 110], engineType: "Simulator", sim: true },
];

export const ORG_TEMPLATES: Record<OrgTemplateKey, OrgTemplate> = {
  "small-flight-school": {
    key: "small-flight-school", label: "Small Flight School",
    description: "Owner-operated Part 61 school. A handful of trainers, a tight-knit instructor team.",
    exampleNames: ["Carolina Flight Academy", "Blue Horizon Flight School", "Cedar Valley Aviation"],
    defaultFleetSize: 5, peopleRatio: 6, instructorRatio: 0.8, utilization: 2.2,
    personaGoals: ["Private Pilot", "Instrument Rating", "Commercial Pilot"],
    fleetMix: TRAINER_MIX, plan: "Starter", businessProfiles: ["part_61", "aircraft_rental", "discovery_flights"], training: true,
  },
  "medium-flight-school": {
    key: "medium-flight-school", label: "Medium Flight School",
    description: "Multi-location Part 141 academy with stage checks and a maintenance department.",
    exampleNames: ["Summit Aviation Academy", "Coastal Wings Flight Center", "Ridgeline Flight Academy"],
    defaultFleetSize: 25, peopleRatio: 6, instructorRatio: 0.9, utilization: 2.6,
    personaGoals: ["Private Pilot", "Instrument Rating", "Commercial Pilot", "CFI"],
    fleetMix: TRAINER_MIX, plan: "Professional", businessProfiles: ["part_141", "part_61", "aircraft_rental", "discovery_flights"], training: true,
  },
  "large-university": {
    key: "large-university", label: "Large University Program",
    description: "Collegiate aviation program: standardized fleet, semester cohorts, high utilization.",
    exampleNames: ["UNC Aviation Program", "State University Flight Sciences", "Mountain West Aeronautics"],
    defaultFleetSize: 100, peopleRatio: 7, instructorRatio: 1.0, utilization: 3.2,
    personaGoals: ["Private Pilot", "Instrument Rating", "Commercial Pilot", "CFI", "Multi-Engine"],
    fleetMix: TRAINER_MIX, plan: "University", businessProfiles: ["university", "part_141"], training: true,
  },
  "flying-club": {
    key: "flying-club", label: "Flying Club",
    description: "Member-owned equity club. Shared aircraft, proficiency flying, monthly dues.",
    exampleNames: ["Blue Ridge Flying Club", "Bay Area Aero Club", "Lakeshore Pilots Association"],
    defaultFleetSize: 5, peopleRatio: 12, instructorRatio: 0.4, utilization: 1.4,
    personaGoals: ["Club member — proficiency", "Club member — cross-country", "Club member — tailwheel"],
    fleetMix: [
      { manufacturer: "Cessna", model: "172S Skyhawk", seats: 4, share: 0.4, wet: [140, 170] },
      { manufacturer: "Cessna", model: "182T Skylane", seats: 4, share: 0.25, wet: [195, 235] },
      { manufacturer: "Piper", model: "PA-28-181 Archer", seats: 4, share: 0.2, wet: [150, 180] },
      { manufacturer: "Mooney", model: "M20J", seats: 4, share: 0.15, wet: [190, 225] },
    ],
    plan: "Starter", businessProfiles: ["flying_club", "aircraft_rental"], training: true,
  },
  "corporate-flight-dept": {
    key: "corporate-flight-dept", label: "Corporate Flight Department",
    description: "In-house flight department flying executives on demand. Jets, crews, trip legs.",
    exampleNames: ["Meridian Corporate Aviation", "Vector Industries Flight Dept", "Northstar Executive Air"],
    defaultFleetSize: 5, peopleRatio: 3, instructorRatio: 0.2, utilization: 1.2,
    personaGoals: ["Executive traveler", "Company principal", "Department traveler"],
    fleetMix: [
      { manufacturer: "Cessna", model: "Citation XLS+", seats: 9, share: 0.4, wet: [3200, 3900], engineType: "Jet" },
      { manufacturer: "Bombardier", model: "Challenger 350", seats: 10, share: 0.3, wet: [4200, 4900], engineType: "Jet" },
      { manufacturer: "Gulfstream", model: "G280", seats: 10, share: 0.3, wet: [4500, 5200], engineType: "Jet" },
    ],
    plan: "Professional", businessProfiles: ["corporate"], training: false,
  },
  fbo: {
    key: "fbo", label: "FBO",
    description: "Fixed-base operator: rentals, discovery flights, fuel and line service.",
    exampleNames: ["Signature FBO", "Skyport Aviation Services", "Harbor Field FBO"],
    defaultFleetSize: 10, peopleRatio: 5, instructorRatio: 0.5, utilization: 1.8,
    personaGoals: ["Renter — recreational", "Discovery flight prospect", "Renter — business travel"],
    fleetMix: [
      { manufacturer: "Cessna", model: "172S Skyhawk", seats: 4, share: 0.5, wet: [160, 195] },
      { manufacturer: "Cessna", model: "182T Skylane", seats: 4, share: 0.2, wet: [200, 240] },
      { manufacturer: "Piper", model: "PA-28-181 Archer", seats: 4, share: 0.2, wet: [165, 200] },
      { manufacturer: "Beechcraft", model: "King Air 350i", seats: 11, share: 0.1, wet: [1750, 2100], engineType: "Turboprop" },
    ],
    plan: "Professional", businessProfiles: ["fbo", "aircraft_rental", "discovery_flights"], training: true,
  },
  "charter-company": {
    key: "charter-company", label: "Charter Company",
    description: "Part 135 on-demand operator. Turboprops and light jets flying revenue legs.",
    exampleNames: ["Executive Air Charter", "Apex Charter Group", "TransBay Air"],
    defaultFleetSize: 8, peopleRatio: 4, instructorRatio: 0.25, utilization: 1.6,
    personaGoals: ["Charter client", "Broker account", "Repeat charter client"],
    fleetMix: [
      { manufacturer: "Pilatus", model: "PC-12 NGX", seats: 9, share: 0.4, wet: [1450, 1750], engineType: "Turboprop" },
      { manufacturer: "Beechcraft", model: "King Air 350i", seats: 11, share: 0.25, wet: [1800, 2150], engineType: "Turboprop" },
      { manufacturer: "Cessna", model: "Citation CJ3+", seats: 8, share: 0.2, wet: [2900, 3400], engineType: "Jet" },
      { manufacturer: "Embraer", model: "Phenom 300E", seats: 9, share: 0.15, wet: [3300, 3900], engineType: "Jet" },
    ],
    plan: "Enterprise", businessProfiles: ["charter_135"], training: false,
  },
  "aircraft-management": {
    key: "aircraft-management", label: "Aircraft Management Company",
    description: "Manages owner aircraft: scheduling, maintenance coordination, owner billing.",
    exampleNames: ["ABC Aircraft Management", "Sentinel Aircraft Services", "BlueTail Management Group"],
    defaultFleetSize: 12, peopleRatio: 2, instructorRatio: 0.15, utilization: 0.9,
    personaGoals: ["Aircraft owner", "Owner — lease-back", "Owner — charter revenue"],
    fleetMix: [
      { manufacturer: "Cirrus", model: "SR22T", seats: 5, share: 0.35, wet: [420, 520] },
      { manufacturer: "Pilatus", model: "PC-12 NGX", seats: 9, share: 0.25, wet: [1450, 1750], engineType: "Turboprop" },
      { manufacturer: "Daher", model: "TBM 960", seats: 6, share: 0.2, wet: [1250, 1500], engineType: "Turboprop" },
      { manufacturer: "Cessna", model: "Citation M2 Gen2", seats: 7, share: 0.2, wet: [2500, 2950], engineType: "Jet" },
    ],
    plan: "Professional", businessProfiles: ["aircraft_management"], training: false,
  },
};

export const FLEET_SIZE_PRESETS = [5, 25, 100, 500];
