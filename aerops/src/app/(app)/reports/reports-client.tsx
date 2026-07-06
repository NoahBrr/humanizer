"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell,
} from "recharts";
import { Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";

// Validated palette (dataviz reference instance): blue = revenue, aqua = activity.
const COLORS = {
  light: { blue: "#2a78d6", aqua: "#1baf7a", grid: "#e5e7eb", text: "#6b7280" },
  dark: { blue: "#3987e5", aqua: "#199e70", grid: "#374151", text: "#9ca3af" },
};

type Row = { name: string; hours: number; revenue: number };

function useMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark ? COLORS.dark : COLORS.light;
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const tooltipStyle = (_dark: boolean) => ({
  borderRadius: 10,
  border: "1px solid var(--color-border)",
  background: "var(--color-card)",
  color: "var(--color-foreground)",
  fontSize: 12,
  boxShadow: "0 4px 12px rgb(0 0 0 / 0.1)",
});

export function ReportsClient({
  summary, daily, byAircraft, byInstructor, byStudent, cancellations,
}: {
  summary: { revenue: number; flights: number; hours: number; avgFlight: number; utilization: number; instructors: number };
  daily: { date: string; revenue: number; flights: number; hours: number }[];
  byAircraft: Row[]; byInstructor: Row[]; byStudent: Row[];
  cancellations: { reason: string; count: number }[];
}) {
  const c = useMode();
  const isDark = c === COLORS.dark;

  const stats = [
    { label: "Revenue (30d)", value: formatCurrency(summary.revenue) },
    { label: "Flights (30d)", value: String(summary.flights) },
    { label: "Hours flown", value: `${summary.hours.toFixed(1)}` },
    { label: "Avg flight length", value: `${summary.avgFlight.toFixed(1)} hrs` },
    { label: "Fleet utilization", value: `${summary.utilization}%` },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-lg font-semibold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Revenue — last 30 days</CardTitle>
              <CardDescription>Payments received per day</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => downloadCsv("revenue-daily.csv", ["Date", "Revenue"], daily.map((d) => [d.date, d.revenue.toFixed(2)]))}>
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
          </CardHeader>
          <CardContent className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.blue} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={c.blue} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: c.text }} tickLine={false} axisLine={false} interval={6} />
                <YAxis tick={{ fontSize: 10, fill: c.text }} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} />
                <Tooltip contentStyle={tooltipStyle(isDark)} formatter={(v) => [formatCurrency(Number(v)), "Revenue"]} />
                <Area type="monotone" dataKey="revenue" stroke={c.blue} strokeWidth={2} fill="url(#rev)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Flights per day</CardTitle>
              <CardDescription>Closed dispatches per day</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => downloadCsv("flights-daily.csv", ["Date", "Flights", "Hours"], daily.map((d) => [d.date, d.flights, d.hours.toFixed(1)]))}>
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
          </CardHeader>
          <CardContent className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: c.text }} tickLine={false} axisLine={false} interval={6} />
                <YAxis tick={{ fontSize: 10, fill: c.text }} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle(isDark)} formatter={(v) => [v, "Flights"]} cursor={{ fill: "transparent" }} />
                <Bar dataKey="flights" fill={c.aqua} radius={[4, 4, 0, 0]} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <RankTable title="Revenue per Aircraft" rows={byAircraft} filename="revenue-by-aircraft.csv" color={c.blue} grid={c.grid} text={c.text} isDark={isDark} />
        <RankTable title="Revenue per Instructor" rows={byInstructor} filename="revenue-by-instructor.csv" color={c.blue} grid={c.grid} text={c.text} isDark={isDark} />
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Cancellation Reasons</CardTitle>
              <CardDescription>Last 30 days</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => downloadCsv("cancellations.csv", ["Reason", "Count"], cancellations.map((r) => [r.reason, r.count]))}>
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
          </CardHeader>
          <CardContent>
            {cancellations.length === 0 && <p className="text-xs text-muted-foreground">No cancellations. 🎉</p>}
            <div className="space-y-2">
              {cancellations.map((r) => {
                const max = cancellations[0]?.count ?? 1;
                return (
                  <div key={r.reason}>
                    <div className="mb-0.5 flex justify-between text-xs">
                      <span>{r.reason}</span>
                      <span className="font-semibold tabular-nums">{r.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${(r.count / max) * 100}%`, background: c.blue }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Revenue per Student</CardTitle>
            <CardDescription>Flight + instruction revenue, last 30 days</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => downloadCsv("revenue-by-student.csv", ["Student", "Hours", "Revenue"], byStudent.map((r) => [r.name, r.hours, r.revenue]))}>
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <THead><TR><TH>Student</TH><TH className="text-right">Hours</TH><TH className="text-right">Revenue</TH></TR></THead>
            <TBody>
              {byStudent.map((r) => (
                <TR key={r.name}>
                  <TD className="text-xs font-medium">{r.name}</TD>
                  <TD className="text-right text-xs tabular-nums">{r.hours.toFixed(1)}</TD>
                  <TD className="text-right text-xs font-medium tabular-nums">{formatCurrency(r.revenue)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function RankTable({
  title, rows, filename, color, grid, text, isDark,
}: {
  title: string; rows: Row[]; filename: string; color: string; grid: string; text: string; isDark: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>Last 30 days</CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={() => downloadCsv(filename, ["Name", "Hours", "Revenue"], rows.map((r) => [r.name, r.hours, r.revenue]))}>
          <Download className="h-3.5 w-3.5" /> CSV
        </Button>
      </CardHeader>
      <CardContent className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={grid} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: text }} tickLine={false} axisLine={false} width={92} />
            <Tooltip contentStyle={tooltipStyle(isDark)} formatter={(v) => [formatCurrency(Number(v)), "Revenue"]} cursor={{ fill: "transparent" }} />
            <Bar dataKey="revenue" radius={[0, 4, 4, 0]} maxBarSize={16} label={{ position: "right", fontSize: 10, fill: text, formatter: (v) => { const n = Number(v); return `$${n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n}`; } }}>
              {rows.map((r) => <Cell key={r.name} fill={color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
