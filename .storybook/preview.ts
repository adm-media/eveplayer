/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Preview } from '@storybook/html-vite';
import '../src/style.css';

const preview: Preview = {
  parameters: {
    layout: 'padded',
    controls: { expanded: true, sort: 'none' },
  },
};

export default preview;
