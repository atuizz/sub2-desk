<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, useId } from 'vue';
const id = `menubar-glass-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
const enhanced = ref(false);
const rasterMap = ref('');
// Red is neutral (no horizontal displacement). Green bends the sampled backdrop
// in opposite directions along the upper/lower lip, leaving the center still.
const map = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="rgb(128,236,128)"/><stop offset=".18" stop-color="rgb(128,151,128)"/><stop offset=".42" stop-color="rgb(128,128,128)"/><stop offset=".65" stop-color="rgb(128,128,128)"/><stop offset=".84" stop-color="rgb(128,104,128)"/><stop offset="1" stop-color="rgb(128,20,128)"/></linearGradient></defs><path fill="url(#g)" d="M0 0h64v64H0z"/></svg>');
let preference: MediaQueryList | undefined;
function sync() { enhanced.value = !preference?.matches && CSS.supports('backdrop-filter', `url("#${id}")`); }
onMounted(() => {
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) { const pixels = ctx.createImageData(64,64); for (let y=0;y<64;y++) for(let x=0;x<64;x++) { const i=(y*64+x)*4; const t=y/63; pixels.data[i]=128; pixels.data[i+1]=Math.round(128+108*(Math.exp(-t*9)-Math.exp(-(1-t)*9))); pixels.data[i+2]=128; pixels.data[i+3]=255; } ctx.putImageData(pixels,0,0); rasterMap.value=canvas.toDataURL(); }
  preference = matchMedia('(prefers-reduced-transparency: reduce)'); sync(); preference.addEventListener('change', sync);
});
onBeforeUnmount(() => preference?.removeEventListener('change', sync));
</script>
<template>
  <div class="menubar-glass" aria-hidden="true">
    <svg class="glass-filter-defs" xmlns="http://www.w3.org/2000/svg"><defs>
      <filter :id="id" x="-10%" y="-100%" width="120%" height="300%" color-interpolation-filters="sRGB">
        <feImage :href="rasterMap || map" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="lens" />
        <feDisplacementMap in="SourceGraphic" in2="lens" scale="14" xChannelSelector="R" yChannelSelector="G" result="refracted" />
        <feGaussianBlur in="refracted" stdDeviation="0.65" />
      </filter>
    </defs></svg>
    <div class="glass-backdrop" :style="enhanced ? { backdropFilter: `url(#${id}) saturate(1.45)`, WebkitBackdropFilter: `url(#${id}) saturate(1.45)` } : undefined"></div>
    <div class="glass-light"></div>
  </div>
</template>
<style scoped>
.menubar-glass{position:absolute;inset:0;pointer-events:none;border-radius:inherit;z-index:-1;overflow:hidden}.glass-filter-defs{position:absolute;width:0;height:0;pointer-events:none}.glass-backdrop{position:absolute;inset:0;backdrop-filter:blur(18px) saturate(145%);-webkit-backdrop-filter:blur(18px) saturate(145%);background:linear-gradient(180deg,#f2faff28,#e6f2ff10 38%,#152d4626);border-bottom:1px solid #eaf7ff65}.glass-light{position:absolute;inset:0;background:linear-gradient(180deg,#ffffff45,transparent 12%,transparent 76%,#c4e7ff18 90%,#ffffff4d);box-shadow:inset 0 1px 0 #ffffff66,inset 0 -2px 3px #e4f5ff24;pointer-events:none}:global(.dark) .glass-backdrop{background:linear-gradient(180deg,#bfdfff1c,#10243c25 42%,#09172b66);border-bottom-color:#cde8ff40}:global(.dark) .glass-light{opacity:.68}@media(prefers-reduced-transparency:reduce){.glass-backdrop{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;background:#455c70}:global(.dark) .glass-backdrop{background:#202e3c}.glass-light{display:none}}@supports not (backdrop-filter:blur(1px)){.glass-backdrop{background:#455c70}:global(.dark) .glass-backdrop{background:#202e3c}}
</style>
