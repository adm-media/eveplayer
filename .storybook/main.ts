/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import type { StorybookConfig } from '@storybook/html-vite';

// Same build-time constant tsup inlines for `EvePlayer.version`. The release
// workflow sets package.json to the released version before building the
// published Storybook, so the page names the version it shows.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const config: StorybookConfig = {
  stories: ['../src/stories/**/*.stories.ts'],
  framework: {
    name: '@storybook/html-vite',
    options: {},
  },
  core: {
    disableTelemetry: true,
  },
  // No "Get started" onboarding checklist in the dev server's sidebar.
  features: {
    sidebarOnboardingChecklist: false,
  },
  viteFinal: (viteConfig) => {
    viteConfig.define = { ...viteConfig.define, __EVE_VERSION__: JSON.stringify(version) };
    // The aliases tsup applies to the published bundle (see tsup.config.ts), so
    // the stories run the same Video.js core and the same worker-free streaming
    // engine as `dist/`. Anchored, so `video.js/dist/video-js.css` (imported
    // by src/style.css) still resolves to the stylesheet.
    const aliases = [
      { find: /^video\.js$/, replacement: 'video.js/core.es.js' },
      {
        find: /^@videojs\/http-streaming$/,
        replacement: '@videojs/http-streaming/dist/videojs-http-streaming-sync-workers.js',
      },
    ];
    const existing = viteConfig.resolve?.alias;
    viteConfig.resolve = {
      ...viteConfig.resolve,
      alias: Array.isArray(existing)
        ? [...existing, ...aliases]
        : [
            ...Object.entries(existing ?? {}).map(([find, replacement]) => ({
              find,
              replacement: replacement as string,
            })),
            ...aliases,
          ],
    };
    return viteConfig;
  },
};

export default config;
