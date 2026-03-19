import { useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useTheme } from '@/contexts/ThemeContext';
import type { PrometheusChartBlock } from '@/lib/types';

// ── Color palettes ─────────────────────────────────────────────────────────────

const DARK_COLORS = ['#7EB26D', '#EAB839', '#6ED0E0', '#EF843C', '#E24D42', '#1F78C1', '#BA43A9'];
const LIGHT_COLORS = ['#629E51', '#E5AC0E', '#64B0C8', '#E0752D', '#BF1B00', '#0A50A1', '#962D82'];

const PANEL_THEME = {
  dark: {
    cardBg: '#141A21',
    headerBg: '#141A21',
    border: '#2B3440',
    divider: '#232B36',
    grid: '#28303A',
    text: '#DCE1E6',
    sub: '#A7B4C3',
    axis: '#B7C2CF',
    badgeBg: '#11161D',
    badgeBorder: '#2B3440',
    badgeText: '#B8C2CC',
    legendBg: '#11161D',
    legendHover: '#161D26',
    legendSelected: '#1B2430',
    tooltipBg: '#11161D',
    tooltipBorder: '#2F3B4A',
    tooltipText: '#DCE1E6',
    tooltipSub: '#A7B4C3',
    emptyBg: '#10151B',
  },
  light: {
    cardBg: '#FFFFFF',
    headerBg: '#FFFFFF',
    border: '#DCE3EC',
    divider: '#E8EDF3',
    grid: '#E9EDF2',
    text: '#1F2937',
    sub: '#475467',
    axis: '#344054',
    badgeBg: '#F8FAFC',
    badgeBorder: '#DCE3EC',
    badgeText: '#475467',
    legendBg: '#F8FAFC',
    legendHover: '#F1F5F9',
    legendSelected: '#E9F0FA',
    tooltipBg: '#FFFFFF',
    tooltipBorder: '#D0D7E2',
    tooltipText: '#111827',
    tooltipSub: '#475467',
    emptyBg: '#F8FAFC',
  },
} as const;

type PanelPalette = (typeof PANEL_THEME)[keyof typeof PANEL_THEME];
const UI_FONT = '"Source Sans 3", system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
const DATA_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

// ── Time formatter ─────────────────────────────────────────────────────────────

function formatTime(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatValue(value: number, unit: string, compact = false): string {
  if (!Number.isFinite(value)) return `--${unit}`;

  if (unit === '%') {
    return `${value.toFixed(compact ? 0 : 1)}%`;
  }

  const abs = Math.abs(value);
  if (compact && abs >= 1000) {
    return `${(value / 1000).toFixed(abs >= 10000 ? 0 : 1)}k${unit}`;
  }

  if (abs >= 100) return `${value.toFixed(0)}${unit}`;
  if (abs >= 10) return `${value.toFixed(1)}${unit}`;
  return `${value.toFixed(2)}${unit}`;
}

// ── Custom Tooltip ─────────────────────────────────────────────────────────────

function CustomTooltip({
  active,
  payload,
  label,
  unit,
  palette,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: number;
  unit: string;
  palette: PanelPalette;
}) {
  if (!active || !payload?.length) return null;
  const sortedPayload = payload
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => {
      const valueDiff = (Number(b.value) || 0) - (Number(a.value) || 0);
      return valueDiff !== 0 ? valueDiff : a.index - b.index;
    });
  return (
    <div
      style={{
        background: palette.tooltipBg,
        border: `1px solid ${palette.tooltipBorder}`,
        borderRadius: 6,
        padding: '6px 8px',
        fontSize: 11.5,
        lineHeight: 1.2,
        color: palette.tooltipText,
        minWidth: 168,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
        fontFamily: UI_FONT,
        textRendering: 'optimizeLegibility',
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
      }}
    >
      <div
        style={{
          color: palette.tooltipSub,
          marginBottom: 4,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.2,
          lineHeight: 1.15,
        }}
      >
        {formatTime(label ?? 0)}
      </div>
      {sortedPayload.map((p, index) => (
        <div
          key={p.name}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginTop: index === 0 ? 0 : 2,
            lineHeight: 1.15,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              minWidth: 0,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: p.color,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                color: palette.tooltipText,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontFamily: UI_FONT,
                fontSize: 11.5,
                fontWeight: 600,
                lineHeight: 1.15,
              }}
            >
              {p.name}
            </span>
          </div>
          <strong
            style={{
              color: p.color,
              flexShrink: 0,
              lineHeight: 1.15,
              fontFamily: DATA_FONT,
              fontSize: 11.5,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatValue(Number(p.value) || 0, unit)}
          </strong>
        </div>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface PrometheusChartCardProps {
  block: PrometheusChartBlock;
}

export function PrometheusChartCard({ block }: PrometheusChartCardProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [hoveredInstance, setHoveredInstance] = useState<string | null>(null);

  const colors = isDark ? DARK_COLORS : LIGHT_COLORS;
  const palette = isDark ? PANEL_THEME.dark : PANEL_THEME.light;
  const seriesColors = Object.fromEntries(
    block.series.map((series, index) => [series.instance, colors[index % colors.length]]),
  );

  // Convert series data to Recharts format: [{ ts, "ip1": val, "ip2": val }, ...]
  const allTimestamps = useMemo(
    () => [...new Set(block.series.flatMap((s) => s.data.map(([ts]) => ts)))].sort((a, b) => a - b),
    [block.series],
  );

  const chartData = useMemo(
    () =>
      allTimestamps.map((ts) => {
        const point: Record<string, number> = { ts };
        for (const series of block.series) {
          const entry = series.data.find(([t]) => t === ts);
          if (entry) point[series.instance] = parseFloat(entry[1].toFixed(2));
        }
        return point;
      }),
    [allTimestamps, block.series],
  );

  // Latest value per series (shown in legend)
  const latestValues = useMemo(() => {
    const values: Record<string, number> = {};
    for (const series of block.series) {
      if (series.data.length > 0) {
        values[series.instance] = parseFloat(
          series.data[series.data.length - 1][1].toFixed(2),
        );
      }
    }
    return values;
  }, [block.series]);

  const hasData = chartData.length > 0;
  const isFilterable = block.series.length > 1;
  const visibleSeries =
    selectedInstance === null
      ? block.series
      : block.series.filter((series) => series.instance === selectedInstance);

  function handleLegendClick(instance: string) {
    if (!isFilterable) return;
    setSelectedInstance((current) => (current === instance ? null : instance));
  }

  return (
    <div
      style={{
        background: palette.cardBg,
        border: `1px solid ${palette.border}`,
        borderRadius: 6,
        overflow: 'visible',
        marginTop: 8,
        marginBottom: 4,
        boxShadow: isDark
          ? 'inset 0 1px 0 rgba(255,255,255,0.02)'
          : '0 1px 2px rgba(16, 24, 40, 0.04)',
        fontFamily: UI_FONT,
        textRendering: 'optimizeLegibility',
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
      }}
    >
      {/* Card header */}
      <div
        style={{
          background: palette.headerBg,
          borderBottom: `1px solid ${palette.divider}`,
          borderTopLeftRadius: 6,
          borderTopRightRadius: 6,
          padding: '10px 12px 8px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span
            style={{
              color: palette.text,
              fontSize: 14,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {block.title}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span
            style={{
              background: palette.badgeBg,
              color: palette.badgeText,
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: 4,
              border: `1px solid ${palette.badgeBorder}`,
              letterSpacing: 0.2,
            }}
          >
            Last {block.timeRange}
          </span>
          {block.datasource && (
            <span
              style={{
                background: palette.badgeBg,
                color: palette.badgeText,
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: 4,
                border: `1px solid ${palette.badgeBorder}`,
                textTransform: 'lowercase',
                letterSpacing: 0.2,
              }}
            >
              {block.datasource}
            </span>
          )}
        </div>
      </div>

      {/* Legend */}
      {hasData && (
        <div
          style={{
            padding: '8px 12px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            borderBottom: `1px solid ${palette.divider}`,
            background: isDark ? '#10151B' : '#FBFCFE',
          }}
        >
          {block.series.map((s) => {
            const isSelected = selectedInstance === s.instance;
            const isDimmed = selectedInstance !== null && !isSelected;
            const isHovered = hoveredInstance === s.instance;

            return (
              <button
                key={s.instance}
                type="button"
                onClick={() => handleLegendClick(s.instance)}
                onMouseEnter={() => setHoveredInstance(s.instance)}
                onMouseLeave={() => setHoveredInstance((current) => (current === s.instance ? null : current))}
                style={{
                  color: palette.text,
                  fontSize: 12.5,
                  background: isSelected
                    ? palette.legendSelected
                    : isHovered
                      ? palette.legendHover
                      : palette.legendBg,
                  border: `1px solid ${isSelected ? seriesColors[s.instance] : palette.badgeBorder}`,
                  padding: '5px 8px',
                  margin: 0,
                  cursor: isFilterable ? 'pointer' : 'default',
                  opacity: isDimmed ? 0.45 : 1,
                  fontWeight: isSelected ? 700 : 600,
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  transition: 'background-color 180ms ease, border-color 180ms ease, opacity 180ms ease',
                  minWidth: 0,
                }}
                className="focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70"
                aria-pressed={isSelected}
                aria-label={
                  latestValues[s.instance] !== undefined
                    ? `${s.instance}，当前值 ${formatValue(latestValues[s.instance], block.unit)}`
                    : s.instance
                }
                title={
                  isFilterable
                    ? isSelected
                      ? '点击恢复显示全部节点'
                      : `点击仅显示 ${s.instance}`
                    : undefined
                }
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: seriesColors[s.instance],
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontFamily: UI_FONT,
                    letterSpacing: 0.1,
                  }}
                >
                  {s.instance}
                </span>
                {latestValues[s.instance] !== undefined && (
                  <strong
                    style={{
                      color: seriesColors[s.instance],
                      marginLeft: 'auto',
                      flexShrink: 0,
                      fontFamily: DATA_FONT,
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: 12.5,
                      fontWeight: 700,
                    }}
                  >
                    {formatValue(latestValues[s.instance], block.unit, true)}
                  </strong>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Chart area */}
      <div style={{ padding: '10px 8px 8px' }}>
        {!hasData ? (
          <div
            style={{
              textAlign: 'center',
              color: palette.sub,
              fontSize: 12,
              padding: '28px 0',
              background: palette.emptyBg,
              borderRadius: 4,
            }}
          >
            暂无数据
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
              <CartesianGrid strokeDasharray="2 4" stroke={palette.grid} vertical={false} />
              <XAxis
                dataKey="ts"
                tickFormatter={formatTime}
                tick={{
                  fill: palette.axis,
                  fontSize: 11.5,
                  fontWeight: 600,
                  fontFamily: UI_FONT,
                }}
                axisLine={false}
                tickLine={false}
                minTickGap={48}
              />
              <YAxis
                tick={{
                  fill: palette.axis,
                  fontSize: 11.5,
                  fontWeight: 600,
                  fontFamily: DATA_FONT,
                }}
                axisLine={false}
                tickLine={false}
                width={60}
                tickFormatter={(v) => formatValue(Number(v), block.unit, true)}
              />
              <Tooltip
                content={<CustomTooltip unit={block.unit} palette={palette} />}
                isAnimationActive={false}
                allowEscapeViewBox={{ x: true, y: true }}
                reverseDirection={{ x: false, y: true }}
                offset={12}
                wrapperStyle={{ zIndex: 20, pointerEvents: 'none' }}
                cursor={{ stroke: palette.divider, strokeWidth: 1 }}
              />
              {visibleSeries.map((s) => (
                <Line
                  key={s.instance}
                  type="linear"
                  dataKey={s.instance}
                  stroke={seriesColors[s.instance]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3, fill: seriesColors[s.instance], stroke: palette.cardBg, strokeWidth: 2 }}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
