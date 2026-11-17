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
    // Pre-bundle every dependency the server renders with. The Cloudflare adapter forwards this list to the
    // workerd environments; without it Vite discovers them on first use, re-optimises mid-session and the
    // request that triggered it fails with "The file does not exist at .vite/deps_ssr/...".
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'zod',
        'jose',
        'ulid',
        'thumbhash',
        'exifr',
        'react-photo-album',
        'react-photo-album/ssr',
        'yet-another-react-lightbox',
        'yet-another-react-lightbox/plugins/zoom',
        'yet-another-react-lightbox/plugins/fullscreen',
        '@dnd-kit/core',
        '@dnd-kit/sortable',
        '@dnd-kit/utilities',
        '@anthropic-ai/sdk',
        '@anthropic-ai/sdk/helpers/zod',
      ],
    },
  },
});
