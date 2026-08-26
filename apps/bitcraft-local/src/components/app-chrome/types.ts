import type React from "react";
import type { LucideIcon } from "lucide-react";

export type AppBrand = {
  logoUrl: string;
  fallbackLogoUrl?: string;
  title: string;
  subtitle: string;
  titleAttribute?: string;
};

export type AppNavigationItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  active?: boolean;
  restricted?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onActivate?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
};

export type AppNavigationGroup = {
  id: string;
  label: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  items: AppNavigationItem[];
};

export type AppUtilityCommand = {
  label: string;
  ariaLabel: string;
  shortcut?: string;
  icon: LucideIcon;
  onActivate: () => void;
};

export type AppUtilityAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  active?: boolean;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  badge?: number;
  content?: string;
  onActivate?: (event: React.MouseEvent<HTMLElement>) => void;
};

export type AppSidebarProps = {
  brand: AppBrand;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  groups: AppNavigationGroup[];
  account?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  status?: React.ReactNode;
  mobileOpen: boolean;
  onRequestClose: () => void;
};

export type AppFrameProps = {
  shellClassName?: string;
  pageLabel: string;
  routeKey: string;
  sidebar: ((mobile: { mobileOpen: boolean; onRequestClose: () => void }) => React.ReactNode) | null;
  utilityBar?: React.ReactNode;
  footer?: React.ReactNode;
  refreshLineVisible?: boolean | null;
  mainRef?: React.Ref<HTMLElement>;
  overlays?: React.ReactNode;
  children: React.ReactNode;
};

export type AppUtilityBarProps = {
  contextLabel: string;
  pageLabel: string;
  command: AppUtilityCommand;
  actions: AppUtilityAction[];
};
