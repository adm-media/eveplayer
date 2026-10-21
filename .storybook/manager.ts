/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */
import { addons } from 'storybook/manager-api';
import { create } from 'storybook/theming/create';

addons.setConfig({
  theme: create({
    base: 'light',
    brandTitle: 'EvePlayer',
    brandUrl: 'https://eveplayer.dev',
    brandTarget: '_blank',
    colorPrimary: '#e00',
    colorSecondary: '#e00',
  }),
});
