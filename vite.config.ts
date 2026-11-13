import {defineConfig} from 'vite';

// Relative base: the built site works from any sub-path (GitHub Pages project sites, a local folder server).
export default defineConfig({base: './', build: {target: 'es2020'}});
