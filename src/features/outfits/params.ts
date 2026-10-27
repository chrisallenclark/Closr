import { SLOTS, type OutfitPieces } from './types';

/** Encodes outfit pieces as route params for the builder (e.g. ?top=…&bottom=…). */
export function piecesQuery(pieces: OutfitPieces): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slot of SLOTS) {
    const id = pieces[slot];
    if (id) out[slot] = id;
  }
  return out;
}

export function parsePieces(params: Record<string, string | string[] | undefined>): OutfitPieces {
  const pieces: OutfitPieces = {};
  for (const slot of SLOTS) {
    const v = params[slot];
    const id = Array.isArray(v) ? v[0] : v;
    if (id) pieces[slot] = id;
  }
  return pieces;
}
