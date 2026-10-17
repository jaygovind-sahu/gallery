// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://gallery.jaygovindsahu.com',
  output: 'server',
  // No Astro sessions: otherwise the adapter provisions a KV namespace we don't need.
  session: false,
  adapter: cloudflare({
    // Photos are resized by our own /img route (Images binding), not by astro:assets.
    imageService: 'passthrough',
  }),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
