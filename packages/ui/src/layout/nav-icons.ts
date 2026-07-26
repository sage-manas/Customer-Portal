import type { NavIcon } from "@cc/domain";
import {
  Award,
  CreditCard,
  FileCheck,
  FileSignature,
  FileText,
  Headphones,
  LayoutDashboard,
  Package,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingCart,
  TrendingUp,
  Truck,
  type LucideIcon,
} from "lucide-react";

/**
 * Resolves the icon *name* carried by the @cc/domain navigation registry to
 * a Lucide component (docs/05 §2.2). The registry stays icon-library-free
 * so the domain layer keeps zero UI dependencies; this map is the only
 * place the two meet.
 */
export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  LayoutDashboard,
  ShoppingCart,
  FileText,
  FileSignature,
  Package,
  Truck,
  Receipt,
  CreditCard,
  Headphones,
  Award,
  TrendingUp,
  FileCheck,
  ShieldCheck,
  Settings,
};
