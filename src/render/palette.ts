// The game's fixed palette. Sprites are string rows; each char maps to a color here. '.' = transparent.
export const PALETTE: Record<string, string> = {
  '0': '#0d0b14', // outline / near-black
  '1': '#2a2238', // deep shadow
  '2': '#4b3f63', // shadow purple-grey
  '3': '#8a7fa3', // mid grey
  '4': '#d8d2e6', // light
  '5': '#ffffff', // white / specular
  g: '#0f3d2e', // felt dark
  G: '#1a5e43', // felt
  h: '#2b8a5e', // felt light
  w: '#4a2a18', // wood dark
  W: '#7a4724', // wood
  v: '#b06d35', // wood light
  s: '#8f9bb3', // silver
  S: '#c9d3e6', // silver light
  r: '#7a1f2b', // red dark
  R: '#c43a3a', // red
  p: '#f06a5a', // red light / pink
  o: '#e07a2e', // orange
  y: '#b8862b', // gold dark
  Y: '#f2c44b', // gold
  e: '#18b36b', // emerald
  E: '#7af0a8', // emerald light
  b: '#2353a8', // blue dark
  B: '#4fa3ff', // blue / energy
  c: '#a8e6ff', // cyan / ice
  m: '#8a3fd1', // purple
  M: '#c78bff', // purple light
};

/** Named UI colors (always from PALETTE). */
export const UI = {
  bg: PALETTE['0'],
  panel: PALETTE['1'],
  panelHi: PALETTE['2'],
  text: PALETTE['4'],
  textDim: PALETTE['3'],
  white: PALETTE['5'],
  energy: PALETTE.B,
  energyDim: PALETTE.b,
  cash: PALETTE.Y,
  emerald: PALETTE.e,
  danger: PALETTE.R,
  meter: PALETTE.m,
  meterHi: PALETTE.M,
};
