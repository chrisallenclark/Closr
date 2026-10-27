import { StyleSheet, View } from 'react-native';

import { ItemImage } from '@/components/ui';
import type { ResolvedPiece } from '@/features/wardrobe/hooks';

export interface OutfitBoardProps {
  pieces: ResolvedPiece[];
  width: number;
  gap?: number;
  radius?: number;
}

/**
 * Mood-board layout: the core pieces (top, bottom) as large tiles on the left, supporting pieces
 * (outerwear, shoes, accessory) stacked on the right. Reads well with plain photos today and with
 * background-removed cutouts later.
 */
export function OutfitBoard({ pieces, width, gap = 6, radius = 12 }: OutfitBoardProps) {
  const main = pieces.filter((p) => p.slot === 'top' || p.slot === 'bottom');
  const side = pieces.filter((p) => p.slot !== 'top' && p.slot !== 'bottom');

  if (side.length === 0 || main.length === 0) {
    // Simple grid when there's nothing to split.
    const cols = pieces.length <= 1 ? 1 : 2;
    const cell = (width - gap * (cols - 1)) / cols;
    return (
      <View style={[styles.grid, { width, gap }]}>
        {pieces.map((p) => (
          <ItemImage key={p.item.id} photo={p.item.photo} radius={radius} style={{ width: cell, height: cell }} />
        ))}
      </View>
    );
  }

  const mainW = Math.round(width * 0.6);
  const sideW = width - mainW - gap;
  const height = mainW * main.length + gap * (main.length - 1);
  const sideCount = Math.max(side.length, 2);
  const sideCell = Math.min(sideW, (height - gap * (sideCount - 1)) / sideCount);

  return (
    <View style={[styles.row, { width, height, gap }]}>
      <View style={{ gap }}>
        {main.map((p) => (
          <ItemImage key={p.item.id} photo={p.item.photo} radius={radius} style={{ width: mainW, height: mainW }} />
        ))}
      </View>
      <View style={[styles.side, { width: sideW, gap }]}>
        {side.map((p) => (
          <ItemImage
            key={p.item.id}
            photo={p.item.photo}
            radius={radius}
            style={{ width: sideCell, height: sideCell }}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row' },
  side: { justifyContent: 'space-between', alignItems: 'center' },
});
