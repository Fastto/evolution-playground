// ArtiFish brand: colours from the logo (deep night blue, teal, orange) and the channel's three typefaces.
export const COLORS = {
  bgDeep: '#001726',
  bg: '#002840',
  surface: '#0A3A55',
  teal: '#0E8FA8',
  tealBright: '#3FD4E6',
  tealDim: '#0B5A6E',
  orange: '#D2491F',
  orangeBright: '#FF7A45',
  orangeDim: '#6E2A17',
  text: '#F2F7F8',
  textMuted: '#8FB3C2',
  textFaint: '#4F7486',
  gold: '#FFD27A', // crests
} as const;

export const FONTS = {
  heading: "'Space Grotesk', system-ui, sans-serif",
  body: "'Inter', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
} as const;

// Replace with the video's URL once it is known.
export const VIDEO_URL = 'https://www.youtube.com/watch?v=qYGI1qK0c1k';
export const VIDEO_TITLE = 'I Simulated Evolution';
