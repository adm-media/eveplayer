// Inlines `@import` rules at build time so `dist/style.css` is fully
// self-contained, matching the JS bundle, which vendors Video.js and needs no
// runtime dependency. Without this the `@import 'video.js/dist/video-js.css'`
// in src/style.css survives into dist/ and forces every consumer to install
// `video.js` just to resolve that one stylesheet. video-js.css has no external
// assets of its own (its icon font is a base64 data: URI), so the result needs
// nothing else.
//
// It lives in config/ (and is passed to postcss-cli with `--config config`)
// rather than at the package root on purpose: a bundler that compiles
// dist/style.css through postcss-loader walks up from the file looking for a
// postcss config, and a root-level one would be picked up by the *consumer's*
// build, which then fails trying to resolve `postcss-import` from its own
// node_modules. Keeping it out of that lookup path makes the package inert for
// consumers.
module.exports = {
  plugins: {
    'postcss-import': {},
  },
};
