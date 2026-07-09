/**
 * Import Center specification catalog. Client-safe: no Prisma/server imports.
 *
 * Each data type declares its target fields (with types and requirements),
 * how duplicates are detected, per-source column aliases (Flight Circle,
 * Flight Schedule Pro, FlightLogger, Aviatize, QuickBooks, Stripe export
 * headers differ), and template rows for the downloadable CSV templates.
 * The engine (lib/import/engine.ts) and the UI both render from this file,
 * so adding a data type is one entry here plus a writer in the engine.
 */

export type FieldType = "string" | "number" | "date" | "boolean" | "email" | "phone";

export type ImportField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Enum-ish guidance shown in the mapper and validated case-insensitively. */
  oneOf?: string[];
  note?: string;
  example: string;
  /** Extra header names that auto-map to this field (any source). */
  aliases?: string[];
};

export type ImportSourceKey =
  | "flight-circle" | "flight-schedule-pro" | "flightlogger" | "aviatize"
  | "quickbooks" | "stripe" | "csv" | "excel" | "paste";

export const IMPORT_SOURCES: { key: ImportSourceKey; label: string; note: string }[] = [
  { key: "flight-circle", label: "Flight Circle", note: "CSV exports from Reports → Export" },
  { key: "flight-schedule-pro", label: "Flight Schedule Pro", note: "CSV exports from Reporting" },
  { key: "flightlogger", label: "FlightLogger", note: "CSV/Excel exports" },
  { key: "aviatize", label: "Aviatize", note: "CSV exports" },
  { key: "quickbooks", label: "QuickBooks", note: "Customer / invoice CSV exports" },
  { key: "stripe", label: "Stripe", note: "Customer / payment CSV exports" },
  { key: "csv", label: "Generic CSV", note: "Any spreadsheet saved as .csv" },
  { key: "excel", label: "Excel", note: ".xlsx workbooks (first sheet)" },
  { key: "paste", label: "Copy / paste", note: "Paste rows straight from a spreadsheet" },
];

export type DuplicateStrategy = "skip" | "update" | "create";

export const DUPLICATE_STRATEGIES: { key: DuplicateStrategy; label: string; note: string }[] = [
  { key: "skip", label: "Skip duplicates", note: "Leave existing records untouched; count the row as skipped" },
  { key: "update", label: "Update existing", note: "Fill mapped fields onto the existing record" },
  { key: "create", label: "Create anyway", note: "Import every row as a new record (use with care)" },
];

export type ImportSpec = {
  key: string;
  label: string;
  group: "People" | "Fleet & Ops" | "Business";
  description: string;
  fields: ImportField[];
  /** Field keys used to detect an existing record, tried in order. */
  duplicateKeys: string[][];
  /** Per-source header → field-key hints (lowercased, normalized). */
  sourceAliases?: Partial<Record<ImportSourceKey, Record<string, string>>>;
  templateRows: string[][];
};

const personCore: ImportField[] = [
  { key: "firstName", label: "First name", type: "string", required: true, example: "Taylor", aliases: ["first", "given name"] },
  { key: "lastName", label: "Last name", type: "string", required: true, example: "Nguyen", aliases: ["last", "surname", "family name"] },
  { key: "fullName", label: "Full name", type: "string", note: "Used only if first/last are not mapped — split on the last space", example: "Taylor Nguyen", aliases: ["name", "student name", "member name", "customer name", "display name"] },
  { key: "email", label: "Email", type: "email", required: true, example: "taylor@example.com", aliases: ["e-mail", "email address"] },
  { key: "phone", label: "Phone", type: "phone", example: "919-555-0142", aliases: ["phone number", "mobile", "cell"] },
];

export const IMPORT_SPECS: ImportSpec[] = [
  {
    key: "students",
    label: "Students",
    group: "People",
    description: "Student pilots with training details, balances, and hours. Creates login-ready accounts (users invite/reset passwords later).",
    fields: [
      ...personCore,
      { key: "trainingGoal", label: "Training goal", type: "string", example: "Private Pilot", aliases: ["goal", "course", "program"] },
      { key: "certificateHeld", label: "Certificate held", type: "string", oneOf: ["NONE", "STUDENT_PILOT", "SPORT", "RECREATIONAL", "PRIVATE", "INSTRUMENT", "COMMERCIAL", "ATP"], example: "STUDENT_PILOT", aliases: ["certificate", "cert", "rating"] },
      { key: "medicalClass", label: "Medical class", type: "string", example: "Third", aliases: ["medical"] },
      { key: "medicalExpiration", label: "Medical expiration", type: "date", example: "2027-03-01", aliases: ["medical expiry", "medical exp"] },
      { key: "accountBalance", label: "Account balance", type: "number", note: "Negative = owes money", example: "-420.50", aliases: ["balance", "account", "amount due"] },
      { key: "totalHours", label: "Total hours", type: "number", example: "32.4", aliases: ["hours", "flight hours", "tt", "total time"] },
      { key: "soloHours", label: "Solo hours", type: "number", example: "4.2", aliases: ["solo"] },
      { key: "externalId", label: "External ID", type: "string", note: "Your old system's ID — used for duplicate detection on re-imports", example: "FC-1042", aliases: ["id", "student id", "customer id"] },
    ],
    duplicateKeys: [["email"], ["externalId"], ["firstName", "lastName", "phone"]],
    sourceAliases: {
      "flight-circle": { "member": "fullName", "account balance": "accountBalance" },
      "flight-schedule-pro": { "user id": "externalId", "primary email": "email" },
      "quickbooks": { "customer": "fullName", "open balance": "accountBalance", "main phone": "phone" },
      "stripe": { "customer id": "externalId", "card name": "fullName" },
    },
    templateRows: [
      ["Taylor", "Nguyen", "", "taylor@example.com", "919-555-0142", "Private Pilot", "STUDENT_PILOT", "Third", "2027-03-01", "-420.50", "32.4", "4.2", "FC-1042"],
      ["Marcus", "Bell", "", "marcus@example.com", "919-555-0143", "Instrument Rating", "PRIVATE", "Second", "2026-11-15", "250.00", "96.2", "12.0", "FC-1043"],
    ],
  },
  {
    key: "members",
    label: "Flying Club Members",
    group: "People",
    description: "Club members (proficiency flyers, renters). Same account shape as students, labeled for club operations.",
    fields: [
      ...personCore,
      { key: "membershipLevel", label: "Membership level", type: "string", example: "Full member", aliases: ["level", "tier", "membership"] },
      { key: "accountBalance", label: "Account balance / dues", type: "number", note: "Negative = owes dues", example: "-89.00", aliases: ["balance", "dues", "dues balance"] },
      { key: "totalHours", label: "Total hours", type: "number", example: "412.5", aliases: ["hours", "total time"] },
      { key: "certificateHeld", label: "Certificate held", type: "string", oneOf: ["NONE", "STUDENT_PILOT", "SPORT", "RECREATIONAL", "PRIVATE", "INSTRUMENT", "COMMERCIAL", "ATP"], example: "PRIVATE", aliases: ["certificate", "cert"] },
      { key: "externalId", label: "External ID", type: "string", example: "MBR-204", aliases: ["id", "member id"] },
    ],
    duplicateKeys: [["email"], ["externalId"], ["firstName", "lastName", "phone"]],
    templateRows: [
      ["Priya", "Grant", "", "priya@example.com", "828-555-0110", "Full member", "-89.00", "412.5", "PRIVATE", "MBR-204"],
      ["Owen", "Diaz", "", "owen@example.com", "828-555-0111", "Social member", "0", "1250.0", "COMMERCIAL", "MBR-205"],
    ],
  },
  {
    key: "instructors",
    label: "Instructors",
    group: "People",
    description: "CFIs with certificates, rates, and expirations.",
    fields: [
      ...personCore,
      { key: "certificates", label: "Certificates", type: "string", note: "Comma list, e.g. CFI,CFII,MEI", example: "CFI,CFII", aliases: ["certs", "ratings"] },
      { key: "hourlyRate", label: "Hourly rate", type: "number", example: "75", aliases: ["rate", "instructor rate", "billing rate"] },
      { key: "cfiNumber", label: "CFI number", type: "string", example: "4123456CFI", aliases: ["cfi #", "certificate number"] },
      { key: "cfiExpiration", label: "CFI expiration", type: "date", example: "2027-08-31", aliases: ["cfi expiry", "renewal"] },
      { key: "medicalExpiration", label: "Medical expiration", type: "date", example: "2026-12-01", aliases: ["medical expiry"] },
      { key: "externalId", label: "External ID", type: "string", example: "CFI-7", aliases: ["id", "instructor id"] },
    ],
    duplicateKeys: [["email"], ["externalId"], ["firstName", "lastName", "phone"]],
    templateRows: [
      ["Sarah", "Chen", "", "sarah.cfi@example.com", "650-555-0120", "CFI,CFII", "75", "4123456CFI", "2027-08-31", "2026-12-01", "CFI-7"],
    ],
  },
  {
    key: "aircraft",
    label: "Aircraft",
    group: "Fleet & Ops",
    description: "Fleet with rates, meters (Hobbs/Tach), and status. Aircraft types are created automatically from make/model.",
    fields: [
      { key: "tailNumber", label: "Tail number", type: "string", required: true, example: "N735GG", aliases: ["tail", "tail #", "registration", "n-number", "reg"] },
      { key: "manufacturer", label: "Manufacturer", type: "string", required: true, example: "Cessna", aliases: ["make"] },
      { key: "model", label: "Model", type: "string", required: true, example: "172S Skyhawk", aliases: ["aircraft model", "type"] },
      { key: "year", label: "Year", type: "number", example: "2018", aliases: ["year built"] },
      { key: "hourlyRateWet", label: "Hourly rate (wet)", type: "number", required: true, example: "189", aliases: ["wet rate", "rate wet", "rental rate", "rate"] },
      { key: "hourlyRateDry", label: "Hourly rate (dry)", type: "number", example: "145", aliases: ["dry rate", "rate dry"] },
      { key: "currentHobbs", label: "Hobbs", type: "number", example: "3412.6", aliases: ["hobbs time", "hobbs meter"] },
      { key: "currentTach", label: "Tach", type: "number", example: "3298.1", aliases: ["tach time", "tach meter", "tacho"] },
      { key: "fuelType", label: "Fuel type", type: "string", example: "100LL", aliases: ["fuel"] },
      { key: "status", label: "Status", type: "string", oneOf: ["AVAILABLE", "IN_MAINTENANCE", "GROUNDED", "RESERVED", "RETIRED"], example: "AVAILABLE", aliases: ["aircraft status"] },
      { key: "locationIcao", label: "Location (ICAO)", type: "string", note: "Must match one of your locations", example: "KAVL", aliases: ["airport", "base", "location"] },
      { key: "serialNumber", label: "Serial number", type: "string", example: "172S11294", aliases: ["serial", "s/n"] },
    ],
    duplicateKeys: [["tailNumber"]],
    sourceAliases: {
      "flight-circle": { "aircraft": "tailNumber", "hobbs": "currentHobbs" },
      "flight-schedule-pro": { "resource": "tailNumber", "wet price": "hourlyRateWet" },
    },
    templateRows: [
      ["N735GG", "Cessna", "172S Skyhawk", "2018", "189", "145", "3412.6", "3298.1", "100LL", "AVAILABLE", "KAVL", "172S11294"],
      ["N88AR", "Piper", "PA-28-181 Archer", "2019", "195", "152", "2101.4", "2044.9", "100LL", "AVAILABLE", "KAVL", "2843122"],
    ],
  },
  {
    key: "locations",
    label: "Locations",
    group: "Fleet & Ops",
    description: "Bases / airports your organization operates from.",
    fields: [
      { key: "name", label: "Location name", type: "string", required: true, example: "Asheville Regional Airport", aliases: ["location", "base name", "airport name"] },
      { key: "icao", label: "ICAO", type: "string", example: "KAVL", aliases: ["airport code", "identifier", "code"] },
      { key: "address", label: "Address", type: "string", example: "61 Terminal Dr, Fletcher, NC", aliases: ["street address"] },
      { key: "timeZone", label: "Time zone", type: "string", example: "America/New_York", aliases: ["tz", "timezone"] },
    ],
    duplicateKeys: [["icao"], ["name"]],
    templateRows: [["Asheville Regional Airport", "KAVL", "61 Terminal Dr, Fletcher, NC", "America/New_York"]],
  },
  {
    key: "lesson-types",
    label: "Lesson Types",
    group: "Fleet & Ops",
    description: "Bookable activity types (dual, solo, ground, checkride…).",
    fields: [
      { key: "name", label: "Name", type: "string", required: true, example: "Dual Flight Lesson", aliases: ["lesson type", "activity", "type"] },
      { key: "durationMin", label: "Default duration (min)", type: "number", example: "120", aliases: ["duration", "minutes", "length"] },
      { key: "color", label: "Color (hex)", type: "string", example: "#1E63D0", aliases: ["colour"] },
      { key: "requiresAircraft", label: "Requires aircraft", type: "boolean", example: "yes", aliases: ["aircraft required"] },
      { key: "requiresInstructor", label: "Requires instructor", type: "boolean", example: "yes", aliases: ["instructor required", "cfi required"] },
    ],
    duplicateKeys: [["name"]],
    templateRows: [
      ["Dual Flight Lesson", "120", "#1E63D0", "yes", "yes"],
      ["Solo Flight", "120", "#38A1E8", "yes", "no"],
      ["Ground Lesson", "60", "#2E3A46", "no", "yes"],
    ],
  },
  {
    key: "schedule",
    label: "Schedule & Flight History",
    group: "Fleet & Ops",
    description: "Reservations and past flights. Matches people by email and aircraft by tail number; past rows import as completed history.",
    fields: [
      { key: "start", label: "Start", type: "date", required: true, note: "Date-time, e.g. 2026-07-10 09:00", example: "2026-07-10 09:00", aliases: ["start time", "begin", "from", "date"] },
      { key: "end", label: "End", type: "date", required: true, example: "2026-07-10 11:00", aliases: ["end time", "until", "to"] },
      { key: "tailNumber", label: "Aircraft tail", type: "string", example: "N735GG", aliases: ["tail", "aircraft", "resource", "registration"] },
      { key: "studentEmail", label: "Student / member email", type: "email", example: "taylor@example.com", aliases: ["student", "member email", "customer email", "renter"] },
      { key: "instructorEmail", label: "Instructor email", type: "email", example: "sarah.cfi@example.com", aliases: ["instructor", "cfi", "cfi email"] },
      { key: "type", label: "Type", type: "string", oneOf: ["FLIGHT_LESSON", "SOLO_FLIGHT", "GROUND_LESSON", "SIMULATOR", "CHECKRIDE", "RENTAL", "MEETING"], example: "FLIGHT_LESSON", aliases: ["event type", "activity"] },
      { key: "status", label: "Status", type: "string", oneOf: ["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW", "WEATHER_CANCELLED"], note: "Defaults to COMPLETED for past rows, SCHEDULED for future", example: "COMPLETED", aliases: ["event status"] },
      { key: "notes", label: "Notes", type: "string", example: "Stage 1 lesson 4", aliases: ["comment", "remarks", "description"] },
    ],
    duplicateKeys: [["start", "tailNumber", "studentEmail"]],
    templateRows: [
      ["2026-07-10 09:00", "2026-07-10 11:00", "N735GG", "taylor@example.com", "sarah.cfi@example.com", "FLIGHT_LESSON", "SCHEDULED", "Stage 1 lesson 4"],
      ["2026-06-02 14:00", "2026-06-02 16:00", "N735GG", "marcus@example.com", "", "SOLO_FLIGHT", "COMPLETED", "Pattern work"],
    ],
  },
  {
    key: "maintenance-orders",
    label: "Maintenance & Work Orders",
    group: "Fleet & Ops",
    description: "Maintenance history and open work orders, matched to aircraft by tail number.",
    fields: [
      { key: "tailNumber", label: "Aircraft tail", type: "string", required: true, example: "N735GG", aliases: ["tail", "aircraft", "registration"] },
      { key: "title", label: "Title", type: "string", required: true, example: "100-hour inspection", aliases: ["work order", "description", "task"] },
      { key: "category", label: "Category", type: "string", example: "Routine Inspection", aliases: ["type"] },
      { key: "status", label: "Status", type: "string", oneOf: ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"], example: "COMPLETED", aliases: ["wo status"] },
      { key: "startDate", label: "Start date", type: "date", required: true, example: "2026-05-14", aliases: ["opened", "date"] },
      { key: "endDate", label: "End date", type: "date", example: "2026-05-16", aliases: ["closed", "completed date"] },
      { key: "costParts", label: "Parts cost", type: "number", example: "412.80", aliases: ["parts", "parts total"] },
      { key: "costLabor", label: "Labor cost", type: "number", example: "690.00", aliases: ["labor", "labour", "labor total"] },
      { key: "assignedTo", label: "Assigned to", type: "string", example: "M. Ortiz", aliases: ["mechanic", "technician"] },
      { key: "correctiveAction", label: "Corrective action", type: "string", example: "Completed IAW 100-hr checklist", aliases: ["resolution", "action taken"] },
    ],
    duplicateKeys: [["tailNumber", "title", "startDate"]],
    templateRows: [
      ["N735GG", "100-hour inspection", "Routine Inspection", "COMPLETED", "2026-05-14", "2026-05-16", "412.80", "690.00", "M. Ortiz", "Completed IAW 100-hr checklist"],
    ],
  },
  {
    key: "squawks",
    label: "Squawks",
    group: "Fleet & Ops",
    description: "Open and historical discrepancies, matched to aircraft by tail number.",
    fields: [
      { key: "tailNumber", label: "Aircraft tail", type: "string", required: true, example: "N735GG", aliases: ["tail", "aircraft", "registration"] },
      { key: "title", label: "Squawk", type: "string", required: true, example: "Right brake spongy", aliases: ["discrepancy", "issue", "description"] },
      { key: "severity", label: "Severity", type: "string", oneOf: ["GROUNDING", "MAJOR", "MINOR"], example: "MINOR", aliases: ["priority"] },
      { key: "status", label: "Status", type: "string", oneOf: ["OPEN", "IN_PROGRESS", "RESOLVED", "DEFERRED"], example: "OPEN", aliases: ["squawk status"] },
      { key: "reportedAt", label: "Reported date", type: "date", example: "2026-06-20", aliases: ["date", "reported"] },
      { key: "resolution", label: "Resolution", type: "string", example: "Bled brakes, ops check good", aliases: ["fix", "action"] },
    ],
    duplicateKeys: [["tailNumber", "title", "reportedAt"]],
    templateRows: [["N735GG", "Right brake spongy", "MINOR", "OPEN", "2026-06-20", ""]],
  },
  {
    key: "invoices",
    label: "Invoices & Balances",
    group: "Business",
    description: "Open and historical invoices matched to people by email; a paid amount records a payment. Use Students/Members import for plain account balances.",
    fields: [
      { key: "number", label: "Invoice number", type: "string", required: true, example: "INV-1042", aliases: ["invoice", "invoice #", "num", "reference"] },
      { key: "customerEmail", label: "Customer email", type: "email", required: true, example: "taylor@example.com", aliases: ["email", "student email", "member email", "customer"] },
      { key: "description", label: "Description", type: "string", example: "June flying — N735GG 2.1 hrs", aliases: ["memo", "line item", "details"] },
      { key: "total", label: "Total", type: "number", required: true, example: "396.90", aliases: ["amount", "invoice total", "balance"] },
      { key: "amountPaid", label: "Amount paid", type: "number", example: "396.90", aliases: ["paid", "payments", "amount received"] },
      { key: "issuedAt", label: "Issued date", type: "date", example: "2026-06-30", aliases: ["date", "invoice date", "created"] },
      { key: "dueAt", label: "Due date", type: "date", example: "2026-07-14", aliases: ["due"] },
      { key: "status", label: "Status", type: "string", oneOf: ["OPEN", "PAID", "PARTIALLY_PAID", "OVERDUE", "VOID"], note: "Computed from amounts when not mapped", example: "PAID", aliases: ["invoice status"] },
    ],
    duplicateKeys: [["number"]],
    sourceAliases: {
      quickbooks: { "num": "number", "customer": "customerEmail", "open balance": "total" },
      stripe: { "id": "number", "amount due": "total", "amount paid": "amountPaid", "customer email": "customerEmail" },
    },
    templateRows: [
      ["INV-1042", "taylor@example.com", "June flying — N735GG 2.1 hrs", "396.90", "396.90", "2026-06-30", "2026-07-14", "PAID"],
      ["INV-1043", "marcus@example.com", "Club dues — July", "89.00", "0", "2026-07-01", "2026-07-15", "OPEN"],
    ],
  },
  {
    key: "leads",
    label: "CRM Leads & Discovery Flights",
    group: "Business",
    description: "Prospects for the admissions pipeline, including discovery-flight bookings.",
    fields: [
      { key: "name", label: "Name", type: "string", required: true, example: "Jamie Fox", aliases: ["lead", "contact", "full name", "prospect"] },
      { key: "email", label: "Email", type: "email", required: true, example: "jamie@example.com", aliases: ["email address"] },
      { key: "phone", label: "Phone", type: "phone", example: "919-555-0177", aliases: ["phone number", "mobile"] },
      { key: "source", label: "Source", type: "string", example: "website", aliases: ["lead source", "channel"] },
      { key: "interest", label: "Interest", type: "string", example: "Private Pilot", aliases: ["program", "course", "interested in"] },
      { key: "status", label: "Status", type: "string", oneOf: ["NEW", "CONTACTED", "DISCOVERY_SCHEDULED", "DISCOVERY_COMPLETED", "APPLICATION", "ENROLLED", "LOST"], example: "CONTACTED", aliases: ["stage", "pipeline stage"] },
      { key: "estValue", label: "Estimated value", type: "number", example: "12000", aliases: ["value", "deal size"] },
      { key: "discoveryFlightAt", label: "Discovery flight date", type: "date", example: "2026-07-19 10:00", aliases: ["discovery flight", "intro flight"] },
      { key: "notes", label: "Notes", type: "string", example: "Referred by member", aliases: ["comment", "remarks"] },
    ],
    duplicateKeys: [["email"], ["name", "phone"]],
    templateRows: [
      ["Jamie Fox", "jamie@example.com", "919-555-0177", "website", "Private Pilot", "CONTACTED", "12000", "2026-07-19 10:00", "Referred by member"],
    ],
  },
  {
    key: "parts",
    label: "Parts & Inventory",
    group: "Business",
    description: "Inventory items with quantities and vendors; opening stock is recorded as a RECEIVE movement for traceability.",
    fields: [
      { key: "partNumber", label: "Part number", type: "string", required: true, example: "CH48110-1", aliases: ["part #", "pn", "sku", "item"] },
      { key: "description", label: "Description", type: "string", required: true, example: "Oil filter", aliases: ["item description", "part name", "name"] },
      { key: "category", label: "Category", type: "string", example: "Engine", aliases: ["group", "class"] },
      { key: "manufacturer", label: "Manufacturer / vendor", type: "string", example: "Champion", aliases: ["vendor", "supplier", "brand", "mfg"] },
      { key: "quantity", label: "Quantity on hand", type: "number", example: "12", aliases: ["qty", "on hand", "stock"] },
      { key: "minQuantity", label: "Minimum quantity", type: "number", example: "4", aliases: ["min", "reorder point", "min qty"] },
      { key: "unitCost", label: "Unit cost", type: "number", example: "32.00", aliases: ["cost", "price"] },
      { key: "location", label: "Bin / shelf", type: "string", example: "Shelf B-3", aliases: ["bin", "shelf", "warehouse"] },
    ],
    duplicateKeys: [["partNumber"]],
    templateRows: [
      ["CH48110-1", "Oil filter", "Engine", "Champion", "12", "4", "32.00", "Shelf B-3"],
      ["6.00-6-8PLY", "Main tire 6.00-6", "Tires", "Goodyear", "6", "2", "145.00", "Rack A-1"],
    ],
  },
];

export function specOf(key: string): ImportSpec | undefined {
  return IMPORT_SPECS.find((s) => s.key === key);
}

/** Header normalization used for auto-mapping. */
export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Suggest a mapping { fieldKey: columnName } for a set of columns. */
export function suggestMapping(spec: ImportSpec, columns: string[], source: ImportSourceKey): Record<string, string> {
  const mapping: Record<string, string> = {};
  const sourceAliases = spec.sourceAliases?.[source] ?? {};
  for (const col of columns) {
    const norm = normalizeHeader(col);
    // 1. source-specific alias
    const viaSource = sourceAliases[norm];
    if (viaSource && !mapping[viaSource]) { mapping[viaSource] = col; continue; }
    // 2. exact field key / label / alias match
    for (const f of spec.fields) {
      if (mapping[f.key]) continue;
      const candidates = [f.key, f.label, ...(f.aliases ?? [])].map(normalizeHeader);
      if (candidates.includes(norm)) { mapping[f.key] = col; break; }
    }
  }
  return mapping;
}

/** CSV template content for a data type (headers = field labels + notes row). */
export function templateCsv(spec: ImportSpec): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  const headers = spec.fields.map((f) => esc(f.label));
  const notes = spec.fields.map((f) =>
    esc([f.required ? "REQUIRED" : "optional", f.type, f.oneOf ? `one of: ${f.oneOf.join("|")}` : "", f.note ?? ""].filter(Boolean).join(" · ")),
  );
  const rows = spec.templateRows.map((r) => r.map(esc).join(","));
  return [headers.join(","), `# ${notes.join(",# ")}`, ...rows].join("\n");
}
