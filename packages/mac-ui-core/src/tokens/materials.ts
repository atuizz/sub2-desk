// macOS Tahoe 26 Liquid Glass Physical Optics & Material Tokens

export interface LiquidGlassPreset {
  backdropBlur: string;
  backdropSaturate: string;
  backdropBrightness: string;
  bgLight: string;
  bgDark: string;
  specularBorder: string;
  specularBorderDark: string;
  innerShadow: string;
  dropShadow: string;
  refractionScale: number; // For SVG feDisplacementMap
}

export const LiquidGlassPresets: Record<'bar' | 'shelf' | 'panel' | 'hud' | 'tile', LiquidGlassPreset> = {
  // 1. Menubar: Ultra-clear high transmittance, nearly zero background by default in Tahoe 26
  bar: {
    backdropBlur: 'blur(20px)',
    backdropSaturate: 'saturate(200%)',
    backdropBrightness: 'brightness(105%)',
    bgLight: 'rgba(255, 255, 255, 0.18)',
    bgDark: 'rgba(18, 22, 28, 0.22)',
    specularBorder: 'linear-gradient(to bottom, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.08) 100%)',
    specularBorderDark: 'linear-gradient(to bottom, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.05) 100%)',
    innerShadow: 'inset 0 -0.5px 0 0 rgba(0, 0, 0, 0.12)',
    dropShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
    refractionScale: 3
  },

  // 2. Dock Shelf: 3D crystal glass with distinct surface meniscus and knife-edge rim
  shelf: {
    backdropBlur: 'blur(32px)',
    backdropSaturate: 'saturate(220%)',
    backdropBrightness: 'brightness(108%)',
    bgLight: 'rgba(255, 255, 255, 0.28)',
    bgDark: 'rgba(20, 24, 32, 0.38)',
    specularBorder: 'linear-gradient(135deg, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.30) 40%, rgba(255,255,255,0.12) 100%)',
    specularBorderDark: 'linear-gradient(135deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.18) 40%, rgba(255,255,255,0.08) 100%)',
    innerShadow: 'inset 0 1px 1px 0 rgba(255, 255, 255, 0.8), inset 0 -1px 1px 0 rgba(0, 0, 0, 0.20)',
    dropShadow: '0 20px 48px -8px rgba(0, 0, 0, 0.38), 0 0 0 0.5px rgba(0, 0, 0, 0.15)',
    refractionScale: 8
  },

  // 3. Floating Window / Dialog Panel
  panel: {
    backdropBlur: 'blur(28px)',
    backdropSaturate: 'saturate(210%)',
    backdropBrightness: 'brightness(104%)',
    bgLight: 'rgba(255, 255, 255, 0.65)',
    bgDark: 'rgba(28, 28, 32, 0.65)',
    specularBorder: 'linear-gradient(to bottom, rgba(255,255,255,0.90) 0%, rgba(255,255,255,0.35) 100%)',
    specularBorderDark: 'linear-gradient(to bottom, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.08) 100%)',
    innerShadow: 'inset 0 1px 1px 0 rgba(255, 255, 255, 0.75)',
    dropShadow: '0 24px 64px -12px rgba(0, 0, 0, 0.32), 0 0 0 1px rgba(0, 0, 0, 0.08)',
    refractionScale: 6
  },

  // 4. Top-Right Pill HUD (Volume / Brightness)
  hud: {
    backdropBlur: 'blur(24px)',
    backdropSaturate: 'saturate(220%)',
    backdropBrightness: 'brightness(110%)',
    bgLight: 'rgba(255, 255, 255, 0.40)',
    bgDark: 'rgba(18, 18, 22, 0.55)',
    specularBorder: 'linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.3) 100%)',
    specularBorderDark: 'linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.1) 100%)',
    innerShadow: 'inset 0 1px 0.5px 0 rgba(255, 255, 255, 0.7)',
    dropShadow: '0 12px 32px -4px rgba(0, 0, 0, 0.28), 0 0 0 0.5px rgba(0, 0, 0, 0.1)',
    refractionScale: 5
  },

  // 5. Control Center Modular Glass Tile
  tile: {
    backdropBlur: 'blur(22px)',
    backdropSaturate: 'saturate(200%)',
    backdropBrightness: 'brightness(105%)',
    bgLight: 'rgba(255, 255, 255, 0.45)',
    bgDark: 'rgba(255, 255, 255, 0.08)',
    specularBorder: 'linear-gradient(to bottom, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.2) 100%)',
    specularBorderDark: 'linear-gradient(to bottom, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.05) 100%)',
    innerShadow: 'inset 0 1px 0.5px 0 rgba(255, 255, 255, 0.5)',
    dropShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
    refractionScale: 4
  }
};
