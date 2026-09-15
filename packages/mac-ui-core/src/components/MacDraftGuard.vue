<script setup lang="ts">
import { ref } from 'vue';
import { useDraftRegistration } from '../composables/useDraftRegistration';

const props = defineProps<{ dirty: boolean; busy?: boolean }>();
const root = ref<HTMLElement | null>(null);
// Keep mounted even when a category or window uses v-show. Never inspect visibility.
useDraftRegistration(root, () => props.dirty, () => Boolean(props.busy));
</script>

<template><span ref="root" hidden aria-hidden="true" data-mac-draft-guard /></template>
