/**
 * Mission Control widget & scene registry (Section 16B). Client-safe — no
 * database imports. The widget keys here are the single vocabulary shared by
 * the wall renderer, the scene editor, and the scenes API validator.
 */
export const PANEL_KEYS = [
  "kpi",
  "ops",
  "fleet",
  "aircraftwall",
  "weather",
  "maintenance",
  "training",
  "cfi",
  "crm",
  "finance",
  "alerts",
  "insights",
] as const;

export type PanelKey = (typeof PANEL_KEYS)[number];

export const PANEL_LABELS: Record<PanelKey, string> = {
  kpi: "KPI Wall",
  ops: "Operations Board",
  fleet: "Fleet Grid",
  aircraftwall: "Aircraft Wall",
  weather: "Weather Wall",
  maintenance: "Maintenance",
  training: "Training",
  cfi: "CFI Panel",
  crm: "Admissions & CRM",
  finance: "Finance",
  alerts: "Alerts",
  insights: "AI Insights",
};

export type Scene = { key: string; label: string; panels: PanelKey[]; builtin: boolean };

export const BUILTIN_SCENES: Scene[] = [
  { key: "default", label: "Mission Control", builtin: true, panels: ["kpi", "ops", "alerts", "fleet", "insights", "maintenance", "training", "finance"] },
  { key: "ops", label: "Operations Wall", builtin: true, panels: ["ops", "weather", "fleet", "alerts", "insights"] },
  { key: "maintenance", label: "Maintenance Wall", builtin: true, panels: ["maintenance", "aircraftwall", "alerts", "insights"] },
  { key: "training", label: "Training Wall", builtin: true, panels: ["training", "cfi", "ops", "alerts", "insights"] },
  { key: "executive", label: "Executive Wall", builtin: true, panels: ["kpi", "finance", "crm", "fleet", "insights", "alerts"] },
  { key: "weather", label: "Weather Wall", builtin: true, panels: ["weather", "ops", "alerts"] },
  { key: "crm", label: "Admissions Wall", builtin: true, panels: ["crm", "insights", "alerts"] },
];
