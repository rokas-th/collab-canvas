import { memo, useMemo } from 'react';
import { penOutline } from './pen';
import type { Stroke } from './presence';

interface InkPathProps {
  stroke: Stroke;
  size: number;
  floor: number;
  layer: 'committed' | 'draft' | 'own';
}

export const InkPath = memo(function InkPath({ stroke, size, floor, layer }: InkPathProps) {
  const { points, pressure, color, id } = stroke;
  const d = useMemo(() => penOutline(points, pressure, size, floor), [points, pressure, size, floor]);
  return <path d={d} fill={color} data-sid={id} data-ink={layer} />;
});
