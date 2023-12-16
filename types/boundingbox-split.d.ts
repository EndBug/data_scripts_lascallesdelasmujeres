declare module 'boundingbox-split' {
  interface BBox {
    centerLat: number;
    centerLng: number;
    maxLat: number;
    minLat: number;
    maxLng: number;
    minLng: number;
  }

  /**
   *
   * @param bbox The bounding box to split
   * @param splitFactor `n`, so that the bounding box is split in `4^n` smaller boxes
   * @returns The promise of an array of smaller bounding boxes
   */
  export function boundingBoxCutting(
    bbox: BBox,
    splitFactor: number
  ): Promise<BBox[]>;
}
