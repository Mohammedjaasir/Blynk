import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { C, F } from '@/lib/theme';
import { AREA } from './copy';
import {
  edgePoint, frameFor, inFrame, kmText, placesAround, project, type Coverage, type Frame, type PlaceAt,
} from './coverage';
import { CENTRE_PLACE_ID, COAST, GALLE_ROAD, RIVER, type LatLng } from './places';

/*
 * The delivery-area map, drawn (no tiles, works offline and on native): the coast to the west,
 * the Bentota river and Galle Road, the store at the centre, the delivery circle from GET /store
 * and the named places with their distances; places outside the circle are hollow, and a place
 * beyond the drawing (Welipenna) gets an arrow at the edge.
 */

const LAND = '#F6F1E4';
const SEA = '#CFE7F5';
const SEA_DEEP = '#B9DCF0';
const COAST_LINE = '#9CC9E4';
const ROAD = '#FFFFFF';
const ROAD_CASE = '#E2DCCB';
const OUTSIDE = '#8D8F9C';

const path = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

function Halo({ x, y, children, size = 11, anchor = 'start', color = C.ink, weight = F.semi }: {
  x: number; y: number; children: string; size?: number; anchor?: 'start' | 'middle' | 'end'; color?: string; weight?: string;
}) {
  return (
    <G>
      <SvgText x={x} y={y} fontSize={size} fontFamily={weight} textAnchor={anchor} stroke={LAND} strokeWidth={3.2} strokeLinejoin="round" fill={LAND}>{children}</SvgText>
      <SvgText x={x} y={y} fontSize={size} fontFamily={weight} textAnchor={anchor} fill={color}>{children}</SvgText>
    </G>
  );
}

export function CoverageMap({ coverage, width, height, compact = false, pin = null, highlight = null }: {
  coverage: Coverage;
  width: number;
  height: number;
  /** The small card version: no place labels, no legend furniture. */
  compact?: boolean;
  /** The customer's spot (a saved address or the order's delivery point). */
  pin?: LatLng | null;
  /** A place id to emphasise (the area being picked). */
  highlight?: string | null;
}) {
  const f: Frame = useMemo(() => frameFor(coverage, width, height, compact ? 1.12 : 1.3), [coverage, width, height, compact]);
  const places = useMemo(() => placesAround(coverage), [coverage]);
  const pr = (p: LatLng) => project(coverage, f, p);
  const r = coverage.radiusKm * f.pxPerKm;

  // the sea: the coastline, closed off along the left edge of the drawing
  const coast = COAST.map(pr);
  const sea = `${path(coast)} L${-50} ${coast[coast.length - 1].y.toFixed(1)} L${-50} ${coast[0].y.toFixed(1)} Z`;
  const river = path(RIVER.map(pr));
  const road = path(GALLE_ROAD.map(pr));
  const scaleKm = coverage.radiusKm >= 3 ? 1 : 0.5;

  return (
    <View style={{ width, height, borderRadius: compact ? 12 : 18, overflow: 'hidden', backgroundColor: LAND }} accessible accessibilityLabel={`${AREA.radiusLabel(coverage)} around ${coverage.landmark ?? coverage.town}`}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="sea" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={SEA_DEEP} />
            <Stop offset="1" stopColor={SEA} />
          </LinearGradient>
        </Defs>
        <Rect width={width} height={height} fill={LAND} />
        {/* faint km grid */}
        {!compact && Array.from({ length: 13 }, (_, i) => i - 6).map((k) => (
          <G key={k}>
            <Line x1={f.cx + k * f.pxPerKm * 2} y1={0} x2={f.cx + k * f.pxPerKm * 2} y2={height} stroke="#EEE7D5" strokeWidth={1} />
            <Line x1={0} y1={f.cy + k * f.pxPerKm * 2} x2={width} y2={f.cy + k * f.pxPerKm * 2} stroke="#EEE7D5" strokeWidth={1} />
          </G>
        ))}
        <Path d={sea} fill="url(#sea)" />
        <Path d={path(coast)} stroke={COAST_LINE} strokeWidth={1.6} fill="none" />
        {!compact && [0.35, 0.7].map((o) => (
          <Path key={o} d={path(coast.map((p) => ({ x: p.x - o * f.pxPerKm, y: p.y })))} stroke="#FFFFFF" strokeOpacity={0.55} strokeWidth={1} strokeDasharray="5 7" fill="none" />
        ))}
        <Path d={river} stroke={SEA} strokeWidth={compact ? 2.5 : 6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d={road} stroke={ROAD_CASE} strokeWidth={compact ? 3.5 : 5.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d={road} stroke={ROAD} strokeWidth={compact ? 2 : 3.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />

        {/* the delivery circle */}
        <Circle cx={f.cx} cy={f.cy} r={r} fill={C.brand} fillOpacity={0.2} />
        <Circle cx={f.cx} cy={f.cy} r={r} fill="none" stroke={C.brandDeep} strokeWidth={compact ? 1.6 : 2.2} strokeDasharray={compact ? '4 4' : '7 6'} />

        {!compact && (
          <>
            {/* the sea widens to the south-west: its name sits there, clear of the places */}
            <Halo x={12} y={height - 46} size={11} anchor="start" color="#4E86A8" weight={F.medium}>{AREA.sea}</Halo>
            {/* inside the top of the circle (the places outside it sit just above) */}
            <Halo x={f.cx} y={f.cy - r + 20} size={11.5} anchor="middle" color={C.brandText} weight={F.bold}>{AREA.radiusLabel(coverage)}</Halo>
          </>
        )}

        {/* places */}
        {places.filter((p) => p.id !== CENTRE_PLACE_ID).map((p) => (
          <PlaceMark key={p.id} p={p} f={f} coverage={coverage} compact={compact} highlight={highlight === p.id} />
        ))}

        {/* the customer's spot */}
        {pin && (() => {
          const q = pr(pin);
          if (!inFrame(f, q, 2)) return null;
          return (
            <G>
              <Circle cx={q.x} cy={q.y} r={compact ? 7 : 9} fill="#2F7BEA" fillOpacity={0.22} />
              <Circle cx={q.x} cy={q.y} r={compact ? 3.5 : 4.5} fill="#2F7BEA" stroke="#fff" strokeWidth={1.5} />
            </G>
          );
        })()}

        {/* the store */}
        <G>
          <Circle cx={f.cx} cy={f.cy} r={compact ? 9 : 13} fill={C.brandInk} fillOpacity={0.12} />
          <Circle cx={f.cx} cy={f.cy} r={compact ? 6 : 8.5} fill={C.brand} stroke={C.brandInk} strokeWidth={compact ? 1.6 : 2} />
          {/* a tiny clock face */}
          <Line x1={f.cx} y1={f.cy} x2={f.cx} y2={f.cy - (compact ? 3 : 4.2)} stroke={C.brandInk} strokeWidth={1.4} strokeLinecap="round" />
          <Line x1={f.cx} y1={f.cy} x2={f.cx + (compact ? 2.4 : 3.2)} y2={f.cy} stroke={C.brandInk} strokeWidth={1.4} strokeLinecap="round" />
          {!compact && (
            <>
              {/* to the east of the store, where there are no places to collide with */}
              <Halo x={f.cx + 16} y={f.cy + 1} size={12.5} anchor="start" weight={F.black}>{AREA.store}</Halo>
              <Halo x={f.cx + 16} y={f.cy + 14} size={10.5} anchor="start" color={C.sub} weight={F.medium}>{coverage.landmark ? `${coverage.landmark}, ${coverage.town}` : coverage.town}</Halo>
            </>
          )}
        </G>

        {!compact && (
          <>
            {/* north arrow */}
            <G>
              <Circle cx={width - 22} cy={22} r={13} fill="#fff" fillOpacity={0.9} />
              <Path d={`M${width - 22} ${12} L${width - 17} ${27} L${width - 22} ${23.5} L${width - 27} ${27} Z`} fill={C.ink} />
              <SvgText x={width - 22} y={41} fontSize={9.5} fontFamily={F.bold} textAnchor="middle" fill={C.ink}>N</SvgText>
            </G>
            {/* scale bar */}
            <G>
              <Rect x={12} y={height - 26} width={scaleKm * f.pxPerKm + 16} height={18} rx={9} fill="#fff" fillOpacity={0.9} />
              <Line x1={20} y1={height - 17} x2={20 + scaleKm * f.pxPerKm} y2={height - 17} stroke={C.ink} strokeWidth={2} />
              <Line x1={20} y1={height - 21} x2={20} y2={height - 13} stroke={C.ink} strokeWidth={2} />
              <Line x1={20 + scaleKm * f.pxPerKm} y1={height - 21} x2={20 + scaleKm * f.pxPerKm} y2={height - 13} stroke={C.ink} strokeWidth={2} />
              <SvgText x={20 + scaleKm * f.pxPerKm + 14} y={height - 13.5} fontSize={10} fontFamily={F.semi} fill={C.ink}>{kmText(scaleKm)}</SvgText>
            </G>
          </>
        )}
      </Svg>
    </View>
  );
}

function PlaceMark({ p, f, coverage, compact, highlight }: { p: PlaceAt; f: Frame; coverage: Coverage; compact: boolean; highlight: boolean }) {
  const pt = project(coverage, f, p);
  const color = p.inside ? C.ink : OUTSIDE;
  if (!inFrame(f, pt)) {
    if (compact) return null;
    // beyond the drawing: an arrow at the edge pointing its way, with the distance
    const e = edgePoint(f, pt, 16);
    const ang = Math.atan2(pt.y - f.cy, pt.x - f.cx);
    const tip = { x: e.x + Math.cos(ang) * 9, y: e.y + Math.sin(ang) * 9 };
    const l = { x: e.x - Math.cos(ang - 0.5) * 8, y: e.y - Math.sin(ang - 0.5) * 8 };
    const rr = { x: e.x - Math.cos(ang + 0.5) * 8, y: e.y - Math.sin(ang + 0.5) * 8 };
    const right = Math.cos(ang) > 0;
    return (
      <G>
        <Path d={`M${tip.x} ${tip.y} L${l.x} ${l.y} L${rr.x} ${rr.y} Z`} fill={OUTSIDE} />
        <Halo x={e.x + (right ? -12 : 12)} y={e.y - 10} size={10.5} anchor={right ? 'end' : 'start'} color={OUTSIDE} weight={F.semi}>{p.name}</Halo>
        <Halo x={e.x + (right ? -12 : 12)} y={e.y + 3} size={10} anchor={right ? 'end' : 'start'} color={OUTSIDE} weight={F.medium}>{`${kmText(p.km)} · outside`}</Halo>
      </G>
    );
  }
  const left = p.label.side === 'left';
  const lx = pt.x + (left ? -8 : 8);
  const ly = pt.y + p.label.dy + 4;
  return (
    <G>
      {highlight && <Circle cx={pt.x} cy={pt.y} r={compact ? 7 : 10} fill={C.brand} fillOpacity={0.55} />}
      <Circle cx={pt.x} cy={pt.y} r={compact ? 2.6 : 4} fill={p.inside ? color : '#fff'} stroke={color} strokeWidth={p.inside ? 0 : 1.6} />
      {!compact && (
        <G>
          <Halo x={lx} y={ly} size={11} anchor={left ? 'end' : 'start'} color={color} weight={p.inside ? F.semi : F.medium}>
            {`${p.name} ${kmText(p.km)}${p.inside ? '' : ' · outside'}`}
          </Halo>
        </G>
      )}
    </G>
  );
}
