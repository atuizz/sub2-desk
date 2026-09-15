export type WorkspaceMode = 'user' | 'admin';

export interface WindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowInstance {
  id: string;
  appId: string;
  title: string;
  icon: string;
  rect: WindowRect;
  prevRect?: WindowRect;
  minW: number;
  minH: number;
  zIndex: number;
  /** Increments whenever the window is activated, including re-opening an existing window. */
  focusRevision?: number;
  isMinimized: boolean;
  isMaximized: boolean;
  isFocused: boolean;
  category: 'user' | 'admin' | 'system';
  customData?: Record<string, any>;
}

export interface AppDefinition {
  id: string;
  name: string;
  title: string;
  icon: string;
  defaultW: number;
  defaultH: number;
  minW?: number;
  minH?: number;
  category: 'user' | 'admin' | 'system';
  component?: any;
  badge?: string | number;
}

export interface MenuItem {
  label: string;
  action?: () => void;
  shortcut?: string;
  disabled?: boolean;
  separator?: boolean;
  children?: MenuItem[];
}

export interface MenuGroup {
  title: string;
  items: MenuItem[];
}
