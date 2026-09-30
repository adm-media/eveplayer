/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Injected by tsup's `define` (see `tsup.config.ts`) with the `package.json`
 * version at build time. Undefined outside a tsup build (vitest), which is why
 * `EvePlayer.version` reads it behind a `typeof` guard.
 */
declare const __EVE_VERSION__: string;
