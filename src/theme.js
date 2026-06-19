/* Single source of truth for the JS-side palette + style helpers.
   Values mirror src/styles/tokens.css. Light theme only. */

export const BRAND = {
  gold: "#C2A24C",
  goldDeep: "#876B1E",
  goldLight: "#D8BE6E",
  navy: "#0A1F3D",
  forest: "#2F4D3A",
  red: "#DC2626",
  cream: "#F5EFE0",
  font: "'Geist', -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "'Geist Mono', ui-monospace, Menlo, monospace",
  ease: "cubic-bezier(0.16, 1, 0.3, 1)",
};

/* The one Light palette (THEMES.light, merged with BRAND). */
export const P = {
  ...BRAND,
  bg: "#FFFFFF",
  card: "#FFFFFF",
  cardBd: "#E7E5E4",
  raise: "#F5F5F4",
  hover: "rgba(0,0,0,0.015)",
  statTile: "#FFFFFF",
  paper: "#F5F5F4",
  text: "#0A0A0A",
  text2: "#525252",
  text3: "#A3A3A3",
  text4: "#D4D4D4",
  line: "#E7E5E4",
  lineSoft: "#EDEDEB",
  goldTxt: "#876B1E",
  goldBg: "#FAF6EA",
  goldLine: "#E5D29B",
  bandLine: "#0A1F3D",
  barMuted: "#0A1F3D",
  sh: "0 12px 32px rgba(0,0,0,0.05), 0 2px 4px rgba(0,0,0,0.04)",
  ctaBg: "#0A1F3D",
  ctaText: "#FFFFFF",
  ctaBd: "#0A1F3D",
  avatarBg: "#0A1F3D",
  avatarText: "#FFFFFF",
  riskFill: "rgba(220,38,38,0.08)",
  riskLine: "#DC2626",
  pgBg: "#FFFFFF",
  pgText: "#0A0A0A",
  pgText2: "#525252",
  pgText3: "#A3A3A3",
  pgLine: "#E7E5E4",
  pgGold: "#876B1E",
  pageDark: false,
  dark: false,
};

export const monoS = (p = P, o = {}) => ({
  fontFamily: p.mono,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: p.text3,
  ...o,
});

export const sectionH = (p = P, o = {}) => ({
  fontFamily: p.font,
  fontWeight: 800,
  fontSize: 22,
  letterSpacing: "-0.025em",
  lineHeight: 1.1,
  color: p.goldTxt,
  ...o,
});

export const cardS = (p = P, o = {}) => ({
  background: p.card,
  border: `1px solid ${p.cardBd}`,
  borderRadius: 20,
  boxShadow: p.sh,
  ...o,
});
