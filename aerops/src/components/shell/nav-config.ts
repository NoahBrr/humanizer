import {
  LayoutDashboard, CalendarDays, Radio, Plane, GraduationCap, Users, Wrench,
  Receipt, BarChart3, Bell, FolderLock, Settings, ClipboardCheck, Activity, Megaphone, Briefcase, Sparkles, type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/intelligence", label: "Intelligence", icon: Sparkles },
  { href: "/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/operations", label: "Operations", icon: Activity },
  { href: "/dispatch", label: "Dispatch", icon: Radio },
  { href: "/aircraft", label: "Aircraft", icon: Plane },
  { href: "/training", label: "Training", icon: ClipboardCheck },
  { href: "/students", label: "Students", icon: GraduationCap },
  { href: "/instructors", label: "Instructors", icon: Users },
  { href: "/crm", label: "Growth", icon: Megaphone },
  { href: "/maintenance", label: "Maintenance", icon: Wrench },
  { href: "/billing", label: "Billing", icon: Receipt },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/executive", label: "Executive", icon: Briefcase },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/documents", label: "Documents", icon: FolderLock },
  { href: "/settings", label: "Settings", icon: Settings },
];
