export const extraWallpapers = [
  { id: 'glass-dawn', name: '暖金晨光', tag: '1672 × 941' },
  { id: 'glass-midnight', name: '午夜蓝玻璃', tag: '1672 × 941' },
  { id: 'glass-lake', name: '冰蓝湖光', tag: '1672 × 941' },
  ...(import.meta.env.VITE_DESKTOP_WALLPAPERS ? [
    { id: 'tahoe-hd', name: 'Tahoe · 浅色 4K', tag: '3840 × 2160' },
    { id: 'tahoe-dark-hd', name: 'Tahoe · 深色 4K', tag: '3840 × 2160' },
    { id: 'tahoe-beach-hd', name: 'Tahoe · 湖畔 4K', tag: '3840 × 2160' },
  ] : []),
];
export const extraWallpaperIds = extraWallpapers.map(item => item.id);
export function wallpaperPreview(id: string) {
  return extraWallpaperIds.includes(id) ? `/assets/wallpaper-thumbs/${id}.jpg` : `/assets/${id}.jpg`;
}
