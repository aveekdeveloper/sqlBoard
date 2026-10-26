export interface EChartsTheme {
  color: string[];
  backgroundColor?: string;
  textStyle?: {
    color?: string;
    fontFamily?: string;
  };
  title?: {
    textStyle?: { color?: string };
  };
  legend?: {
    textStyle?: { color?: string };
  };
}

const FONT_STACK =
  "Inter, 'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, sans-serif";

export const ECHARTS_THEMES: Record<string, EChartsTheme> = {
  swiss: {
    color: ['#1d5c4a', '#c8412f', '#a56b1f', '#4a6fa5', '#2f6b4f', '#7b6fa0', '#b07d4f', '#3f7f8f'],
    textStyle: { color: '#17181a', fontFamily: FONT_STACK },
    title: { textStyle: { color: '#17181a' } },
    legend: { textStyle: { color: '#5d5a53' } },
  },
  'powerbi-light': {
    color: ['#118DFF', '#12239E', '#E66C37', '#6B007B', '#E044A7', '#744EC2', '#D9B300', '#D64550'],
    textStyle: { color: '#252423', fontFamily: FONT_STACK },
    title: { textStyle: { color: '#252423' } },
    legend: { textStyle: { color: '#605E5C' } },
  },
  nyt: {
    color: ['#3268a1', '#9f3a38', '#6b8e23', '#7b6888', '#6b4c3b', '#3b7b7b', '#a05d56', '#4f6d7a'],
    textStyle: { color: '#121212', fontFamily: FONT_STACK },
    title: { textStyle: { color: '#121212' } },
    legend: { textStyle: { color: '#595959' } },
  },
  economist: {
    color: ['#006BA2', '#DB444B', '#6B007B', '#3EBCD2', '#379A8B', '#EBB434', '#B4BA39', '#D1B2C5'],
    textStyle: { color: '#1e1e1e', fontFamily: FONT_STACK },
    title: { textStyle: { color: '#1e1e1e' } },
    legend: { textStyle: { color: '#5a5a5a' } },
  },
};

export function resolveEChartsTheme(sql: string): { name: string; colors: string[] | null; preset: EChartsTheme } {
  const themeMatch = sql.match(/--\s*@theme\s*:\s*(.+)/i);
  const colorsMatch = sql.match(/--\s*@colors\s*:\s*(.+)/i);
  const colors = colorsMatch
    ? colorsMatch[1]
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : null;
  const name = themeMatch ? themeMatch[1].trim() : 'swiss';
  const preset = ECHARTS_THEMES[name] ?? ECHARTS_THEMES.swiss;
  return { name, colors, preset };
}

export function applyEChartsTheme(option: Record<string, unknown>, sql: string): Record<string, unknown> {
  const { colors, preset } = resolveEChartsTheme(sql);
  return {
    ...option,
    color: colors && colors.length > 0 ? colors : preset.color,
    textStyle: {
      ...(option.textStyle as Record<string, unknown> | undefined),
      ...(preset.textStyle ?? {}),
    },
    title:
      option.title && typeof option.title === 'object'
        ? { ...(option.title as Record<string, unknown>), textStyle: { ...((option.title as any).textStyle ?? {}), ...(preset.title?.textStyle ?? {}) } }
        : option.title,
    legend:
      option.legend && typeof option.legend === 'object'
        ? { ...(option.legend as Record<string, unknown>), textStyle: { ...((option.legend as any).textStyle ?? {}), ...(preset.legend?.textStyle ?? {}) } }
        : option.legend,
  };
}