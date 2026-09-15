// Apple Human Interface Guidelines (macOS Tahoe 26) Standard Color Palette

export const AppleColors = {
  blue: {
    light: '#007aff',
    dark: '#0a84ff',
    rgb: '0, 122, 255'
  },
  purple: {
    light: '#af52de',
    dark: '#bf5af2',
    rgb: '175, 82, 222'
  },
  indigo: {
    light: '#5856d6',
    dark: '#5e5ce6',
    rgb: '88, 86, 214'
  },
  pink: {
    light: '#ff2d55',
    dark: '#ff375f',
    rgb: '255, 45, 85'
  },
  red: {
    light: '#ff3b30',
    dark: '#ff453a',
    rgb: '255, 59, 48'
  },
  orange: {
    light: '#ff9500',
    dark: '#ff9f0a',
    rgb: '255, 149, 0'
  },
  yellow: {
    light: '#ffcc00',
    dark: '#ffd60a',
    rgb: '255, 204, 0'
  },
  green: {
    light: '#34c759',
    dark: '#30d158',
    rgb: '52, 199, 89'
  },
  teal: {
    light: '#00c7be',
    dark: '#40c8e0',
    rgb: '0, 199, 190'
  },
  cyan: {
    light: '#32ade6',
    dark: '#64d2ff',
    rgb: '50, 173, 230'
  },
  gray: {
    light: '#8e8e93',
    dark: '#98989d',
    rgb: '142, 142, 147'
  }
} as const;

export type AppleColorName = keyof typeof AppleColors;
