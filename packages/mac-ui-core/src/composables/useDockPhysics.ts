import { ref } from 'vue';

export function useDockPhysics(baseWidth = 50, maxScale = 1.65, distanceLimit = 220) {
  const mouseX = ref<number | null>(null);

  function calculateScale(itemCenterX: number): number {
    if (mouseX.value === null) return 1;
    const dist = Math.abs(mouseX.value - itemCenterX);
    if (dist >= distanceLimit) return 1;

    // Bell curve easing using cosine for apple-like parabolic shape
    const progress = dist / distanceLimit;
    const factor = Math.cos((progress * Math.PI) / 2);
    // Smooth power curve for authentic apple dock magnification
    return 1 + (maxScale - 1) * Math.pow(factor, 1.8);
  }

  function setMouseX(x: number | null) {
    mouseX.value = x;
  }

  return {
    mouseX,
    setMouseX,
    calculateScale,
    baseWidth
  };
}
