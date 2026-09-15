<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { MacButton } from '@sub2-mac/core';
import { renderSafeContent } from './content';
const props = withDefaults(defineProps<{ content: string; markdown?: boolean; slug?: string; tools?: boolean; language?: 'zh' | 'en' }>(), { markdown: true, slug: '', tools: false, language: 'zh' });
const html = computed(() => renderSafeContent(props.content, props.markdown, props.slug));
const root = ref<HTMLElement | null>(null);
const headings = ref<{ text: string; level: number; element: HTMLElement }[]>([]);
const tocVisible = ref(true); const activeHeading=ref(-1); let generation = 0;
let scrollFrame:number|undefined;
function stopTracking(){if(typeof window==='undefined')return;if(scrollFrame!==undefined)window.cancelAnimationFrame(scrollFrame);scrollFrame=undefined;document.removeEventListener('scroll',scheduleHeading,true);window.removeEventListener('resize',scheduleHeading);root.value?.removeEventListener('load',scheduleHeading,true);}
function updateHeading(){scrollFrame=undefined;if(!props.tools||!root.value||!headings.value.length){activeHeading.value=-1;return;}
  let scrollRoot=root.value.parentElement;while(scrollRoot){if(/auto|scroll/.test(getComputedStyle(scrollRoot).overflowY)&&scrollRoot.scrollHeight>scrollRoot.clientHeight)break;scrollRoot=scrollRoot.parentElement;}
  const top=scrollRoot?Math.max(0,scrollRoot.getBoundingClientRect().top):0;
  let index=0;for(let i=0;i<headings.value.length;i++){if(headings.value[i].element.getBoundingClientRect().top<=top+24)index=i;else break;}
  activeHeading.value=index;
}
function scheduleHeading(){if(scrollFrame===undefined)scrollFrame=window.requestAnimationFrame(updateHeading);}

watch([html, () => props.tools, () => props.language], async () => {
  const id = ++generation; stopTracking();headings.value = [];activeHeading.value=-1; await nextTick();
  if (id !== generation || !props.tools || !root.value) return;
  headings.value = Array.from(root.value.querySelectorAll<HTMLElement>('h1,h2,h3,h4')).map(element => ({ text: element.textContent || '', level: Number(element.tagName[1]), element }));
  document.addEventListener('scroll',scheduleHeading,true);window.addEventListener('resize',scheduleHeading);root.value.addEventListener('load',scheduleHeading,true);scheduleHeading();
  root.value.querySelectorAll('pre').forEach(pre => {
    const code = pre.querySelector('code'); if (!code) return;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'public-copy-code';
    const label = props.language === 'en' ? 'Copy code' : '复制代码'; button.textContent = label;
    button.addEventListener('click', async () => {
      if (button.disabled) return; button.disabled = true;
      try { await navigator.clipboard.writeText(code.textContent || ''); if (id === generation) button.textContent = props.language === 'en' ? 'Copied' : '已复制'; }
      catch { if (id === generation) button.textContent = props.language === 'en' ? 'Copy failed — select text manually' : '复制失败，请手动选择代码'; }
      finally { if (id === generation) button.disabled = false; }
    });
    pre.before(button);
  });
}, { immediate: true, flush: 'post' });
function jump(element: HTMLElement) { element.setAttribute('tabindex', '-1'); element.focus({ preventScroll: true }); element.scrollIntoView({ block: 'start', behavior: 'auto' });activeHeading.value=headings.value.findIndex(h=>h.element===element);scheduleHeading(); }
function followAnchor(event: MouseEvent) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
  if (!link || !root.value?.contains(link)) return;
  let anchor: string;
  try { anchor = decodeURIComponent(link.getAttribute('href')!.slice(1)); } catch { return; }
  const target = [...root.value.querySelectorAll<HTMLElement>('[data-content-anchor]')].find(el =>
    el.dataset.contentAnchor === anchor || el.dataset.contentOriginalAnchor === anchor || el.id === anchor);
  if (target) { event.preventDefault(); jump(target); }
}
onBeforeUnmount(() => { generation++;stopTracking(); });
</script>
<template><div class="public-reader"><nav v-if="tools && headings.length" aria-label="文档目录"><MacButton @click="tocVisible = !tocVisible">{{ tocVisible ? '收起目录' : '显示目录' }}</MacButton><ol v-if="tocVisible" class="public-toc"><li v-for="(heading, index) in headings" :key="index"><button type="button" :aria-current="activeHeading===index?'location':undefined" :style="{ paddingLeft: `${(heading.level - 1) * 10}px` }" @click="jump(heading.element)">{{ heading.text }}</button></li></ol></nav><div :key="`${tools}:${language}:${content}`" ref="root" class="public-rich-content" @click="followAnchor" v-html="html"></div></div></template>
<style scoped>
.public-reader { min-width: 0; }.public-toc button[aria-current="location"]{font-weight:650;background:color-mix(in srgb,var(--accent-color,#007aff) 12%,transparent);border-radius:5px}.public-toc { max-height: 220px; overflow: auto; margin: 12px 0; }.public-toc button { text-align: left; color: var(--accent-color, #007aff); padding: 5px; overflow-wrap: anywhere; }.public-rich-content :deep(.public-copy-code) { padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border-color, #8885); color: inherit; background: var(--input-bg, #8881); margin-top: 10px; }.public-rich-content :deep(button:focus-visible) { outline: 2px solid var(--accent-color, #007aff); }
.public-rich-content { overflow-wrap: anywhere; line-height: 1.75; color: var(--text-primary, #242428); }
.public-rich-content :deep(h1), .public-rich-content :deep(h2), .public-rich-content :deep(h3) { font-weight: 650; margin: 1.3em 0 .65em; line-height: 1.35; }
.public-rich-content :deep(h1) { font-size: 24px; }.public-rich-content :deep(h2) { font-size: 19px; }
.public-rich-content :deep(p), .public-rich-content :deep(ul), .public-rich-content :deep(ol) { margin: .8em 0; }
.public-rich-content :deep(ul) { list-style: disc; padding-left: 24px; }.public-rich-content :deep(ol) { list-style: decimal; padding-left: 24px; }
.public-rich-content :deep(a) { color: var(--accent-color, #007aff); text-decoration: underline; }
.public-rich-content :deep(a:focus-visible) { outline: 2px solid currentColor; outline-offset: 3px; }
.public-rich-content :deep(pre), .public-rich-content :deep(table) { display: block; max-width: 100%; overflow: auto; }
.public-rich-content :deep(pre) { padding: 14px; background: rgb(128 128 140 / 10%); border-radius: 8px; }
.public-rich-content :deep(td), .public-rich-content :deep(th) { padding: 7px 12px; border: 1px solid var(--border-color, #8885); }
.public-rich-content :deep(img) { max-width: 100%; height: auto; }.public-rich-content :deep(blockquote) { border-left: 3px solid #8885; padding-left: 14px; }
</style>
