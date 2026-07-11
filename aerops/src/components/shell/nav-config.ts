import {
  LayoutDashboard, CalendarDays, Radio, Plane, GraduationCap, Users, Wrench,
  Receipt, ClipboardList, BarChart3, Bell, FolderLock, Settings, UploadCloud, ClipboardCheck, Activity, Megaphone, Briefcase, Sparkles, MonitorPlay, Wallet, type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };
export type NavGroup = { label: string; items: NavItem[] };

/**
 * Primary navigation, grouped by operational domain so the sidebar scans as
 * five short lists instead of one long one. The groups are the source of
 * truth; `NAV_ITEMS` is the flat projection consumed by the mobile nav, the
 * command palette, and the permission-mapping constitution test. Every href
 * must have a matching entry in SECTION_PERMISSIONS (tested).
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Command Center",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/mission-control", label: "Mission Control", icon: MonitorPlay },
      { href: "/intelligence", label: "Intelligence", icon: Sparkles },
    ],
  },
  {
    label: "Flight Operations",
    items: [
      { href: "/schedule", label: "Schedule", icon: CalendarDays },
      { href: "/dispatch", label: "Dispatch", icon: Radio },
      { href: "/operations", label: "Operations", icon: Activity },
      { href: "/aircraft", label: "Aircraft", icon: Plane },
      { href: "/maintenance", label: "Maintenance", icon: Wrench },
    ],
  },
  {
    label: "Training",
    items: [
      { href: "/students", label: "Students", icon: GraduationCap },
      { href: "/instructors", label: "Instructors", icon: Users },
      { href: "/training", label: "Training", icon: ClipboardCheck },
    ],
  },
  {
    label: "Business",
    items: [
      { href: "/billing", label: "Billing", icon: Receipt },
      { href: "/billing/reviews", label: "Revenue Reviews", icon: ClipboardList },
      { href: "/billing/my", label: "My Payments", icon: Wallet },
      { href: "/reports", label: "Reports", icon: BarChart3 },
      { href: "/crm", label: "Growth", icon: Megaphone },
      { href: "/executive", label: "Executive", icon: Briefcase },
    ],
  },
  {
    label: "Organization",
    items: [
      { href: "/notifications", label: "Notifications", icon: Bell },
      { href: "/documents", label: "Documents", icon: FolderLock },
      { href: "/import", label: "Import Data", icon: UploadCloud },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

// Flat projection — order follows the groups. Kept for the mobile nav, command
// palette, and the constitution's navigation-permission scan.
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
