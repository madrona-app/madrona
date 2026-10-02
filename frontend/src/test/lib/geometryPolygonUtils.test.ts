import { describe, it, expect } from 'vitest';
import {
  isRectangular,
  isPolygon,
  rectangularToPolygon,
  normalizeGeometry,
  calculateWallLength,
  calculateWallAngle,
  calculateWallMidpoint,
  calculateWallNormal,
  calculatePolygonCentroid,
  calculatePolygonArea,
  calculateBoundingBox,
  isPointInPolygon,
  floorPlanTo3D,
  threeDToFloorPlan,
  calculateArtworkPosition,
  generateId,
  snapToGrid,
  snapToAngle,
  distance,
  closestPointOnSegment,
  constrainToWallBounds,
} from '../../lib/geometry/polygonUtils';
import type {
  Vertex,
  Wall,
  RectangularGeometry,
  PolygonGeometry,
} from '../../lib/geometry/polygonUtils';

const SQUARE_VERTICES: Vertex[] = [
  { id: 'v1', x: 0, y: 0 },
  { id: 'v2', x: 100, y: 0 },
  { id: 'v3', x: 100, y: 100 },
  { id: 'v4', x: 0, y: 100 },
];

const SQUARE_WALLS: Wall[] = [
  { id: 'w1', start_vertex: 'v1', end_vertex: 'v2', height_cm: 300, openings: [] },
  { id: 'w2', start_vertex: 'v2', end_vertex: 'v3', height_cm: 300, openings: [] },
  { id: 'w3', start_vertex: 'v3', end_vertex: 'v4', height_cm: 300, openings: [] },
  { id: 'w4', start_vertex: 'v4', end_vertex: 'v1', height_cm: 300, openings: [] },
];

describe('geometry/polygonUtils', () => {
  describe('type guards', () => {
    it('isRectangular detects rectangular geometry', () => {
      const rect: RectangularGeometry = {
        type: 'rectangular',
        width_cm: 100,
        depth_cm: 100,
        walls: {
          north: { length: 100 },
          south: { length: 100 },
          east: { length: 100 },
          west: { length: 100 },
        },
      };
      expect(isRectangular(rect)).toBe(true);
      expect(isPolygon(rect)).toBe(false);
    });

    it('isPolygon detects polygon geometry', () => {
      const poly: PolygonGeometry = {
        type: 'polygon',
        vertices: SQUARE_VERTICES,
        walls: SQUARE_WALLS,
        columns: [],
        units: 'cm',
      };
      expect(isPolygon(poly)).toBe(true);
      expect(isRectangular(poly)).toBe(false);
    });
  });

  describe('rectangularToPolygon', () => {
    it('creates 4 vertices and 4 walls', () => {
      const rect: RectangularGeometry = {
        type: 'rectangular',
        width_cm: 500,
        depth_cm: 400,
        walls: {
          north: { length: 500 },
          south: { length: 500 },
          east: { length: 400 },
          west: { length: 400 },
        },
      };
      const poly = rectangularToPolygon(rect);
      expect(poly.vertices).toHaveLength(4);
      expect(poly.walls).toHaveLength(4);
      expect(poly.vertices[2]).toEqual({ id: 'v3', x: 500, y: 400 });
      expect(poly.units).toBe('cm');
    });
  });

  describe('normalizeGeometry', () => {
    it('passes through polygon unchanged', () => {
      const poly: PolygonGeometry = {
        type: 'polygon',
        vertices: SQUARE_VERTICES,
        walls: SQUARE_WALLS,
        columns: [],
        units: 'cm',
      };
      expect(normalizeGeometry(poly)).toBe(poly);
    });

    it('converts rectangular to polygon', () => {
      const rect: RectangularGeometry = {
        type: 'rectangular',
        width_cm: 100,
        depth_cm: 100,
        walls: {
          north: { length: 100 },
          south: { length: 100 },
          east: { length: 100 },
          west: { length: 100 },
        },
      };
      expect(normalizeGeometry(rect).type).toBe('polygon');
    });
  });

  describe('wall calculations', () => {
    it('calculateWallLength returns 100 for axis-aligned unit wall', () => {
      expect(calculateWallLength(SQUARE_WALLS[0], SQUARE_VERTICES)).toBe(100);
    });

    it('calculateWallLength returns 0 for missing vertices', () => {
      const badWall: Wall = {
        id: 'x',
        start_vertex: 'nope',
        end_vertex: 'also_nope',
        height_cm: 300,
        openings: [],
      };
      expect(calculateWallLength(badWall, SQUARE_VERTICES)).toBe(0);
    });

    it('calculateWallAngle returns 0 for east-pointing wall', () => {
      // Wall from v1(0,0) to v2(100,0) points along +X
      expect(calculateWallAngle(SQUARE_WALLS[0], SQUARE_VERTICES)).toBe(0);
    });

    it('calculateWallAngle returns pi/2 for north-pointing wall', () => {
      // Wall from v2(100,0) to v3(100,100) points along +Y
      expect(calculateWallAngle(SQUARE_WALLS[1], SQUARE_VERTICES)).toBeCloseTo(
        Math.PI / 2,
        5
      );
    });

    it('calculateWallMidpoint returns (50, 0) for south wall', () => {
      expect(calculateWallMidpoint(SQUARE_WALLS[0], SQUARE_VERTICES)).toEqual({
        x: 50,
        y: 0,
      });
    });

    it('calculateWallMidpoint returns (0,0) for missing vertices', () => {
      const bad: Wall = {
        id: 'x',
        start_vertex: 'missing',
        end_vertex: 'missing',
        height_cm: 300,
        openings: [],
      };
      expect(calculateWallMidpoint(bad, SQUARE_VERTICES)).toEqual({ x: 0, y: 0 });
    });

    it('calculateWallNormal returns inward-pointing unit vector', () => {
      // First wall is horizontal bottom; inward normal should point +Y (into room)
      const n = calculateWallNormal(SQUARE_WALLS[0], SQUARE_VERTICES);
      expect(n.y).toBeCloseTo(1, 5);
      expect(n.x).toBeCloseTo(0, 5);
    });
  });

  describe('polygon calculations', () => {
    it('calculatePolygonCentroid returns geometric mean', () => {
      expect(calculatePolygonCentroid(SQUARE_VERTICES)).toEqual({
        x: 50,
        y: 50,
      });
    });

    it('calculatePolygonCentroid returns {0,0} for empty array', () => {
      expect(calculatePolygonCentroid([])).toEqual({ x: 0, y: 0 });
    });

    it('calculatePolygonArea returns correct area for unit square', () => {
      expect(calculatePolygonArea(SQUARE_VERTICES)).toBe(10000);
    });

    it('calculatePolygonArea returns 0 for fewer than 3 vertices', () => {
      expect(calculatePolygonArea([])).toBe(0);
      expect(calculatePolygonArea([{ id: 'a', x: 0, y: 0 }])).toBe(0);
      expect(
        calculatePolygonArea([
          { id: 'a', x: 0, y: 0 },
          { id: 'b', x: 1, y: 0 },
        ])
      ).toBe(0);
    });

    it('calculateBoundingBox returns min/max and size', () => {
      const bb = calculateBoundingBox(SQUARE_VERTICES);
      expect(bb).toEqual({
        minX: 0,
        minY: 0,
        maxX: 100,
        maxY: 100,
        width: 100,
        height: 100,
      });
    });

    it('calculateBoundingBox returns zeros for empty array', () => {
      expect(calculateBoundingBox([])).toEqual({
        minX: 0,
        minY: 0,
        maxX: 0,
        maxY: 0,
        width: 0,
        height: 0,
      });
    });
  });

  describe('isPointInPolygon', () => {
    it('returns true for point clearly inside', () => {
      expect(isPointInPolygon({ x: 50, y: 50 }, SQUARE_VERTICES)).toBe(true);
    });

    it('returns false for point clearly outside', () => {
      expect(isPointInPolygon({ x: 200, y: 200 }, SQUARE_VERTICES)).toBe(false);
      expect(isPointInPolygon({ x: -10, y: 50 }, SQUARE_VERTICES)).toBe(false);
    });
  });

  describe('coordinate conversion', () => {
    it('floorPlanTo3D centers and converts cm to meters', () => {
      const result = floorPlanTo3D(100, 200, { x: 50, y: 100 });
      expect(result.x).toBeCloseTo(0.5, 5);
      expect(result.z).toBeCloseTo(1, 5);
    });

    it('threeDToFloorPlan is inverse of floorPlanTo3D', () => {
      const centroid = { x: 50, y: 100 };
      const original = { x: 100, y: 200 };
      const three = floorPlanTo3D(original.x, original.y, centroid);
      const back = threeDToFloorPlan(three.x, three.z, centroid);
      expect(back.x).toBeCloseTo(original.x, 5);
      expect(back.y).toBeCloseTo(original.y, 5);
    });
  });

  describe('distance and segment helpers', () => {
    it('distance computes euclidean distance', () => {
      expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    });

    it('distance returns 0 for same point', () => {
      expect(distance({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
    });

    it('closestPointOnSegment projects onto segment', () => {
      const result = closestPointOnSegment(
        { x: 5, y: 5 },
        { x: 0, y: 0 },
        { x: 10, y: 0 }
      );
      expect(result.x).toBe(5);
      expect(result.y).toBe(0);
      expect(result.t).toBeCloseTo(0.5, 5);
    });

    it('closestPointOnSegment clamps at segment start', () => {
      const result = closestPointOnSegment(
        { x: -5, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 0 }
      );
      expect(result.t).toBe(0);
    });

    it('closestPointOnSegment clamps at segment end', () => {
      const result = closestPointOnSegment(
        { x: 20, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 0 }
      );
      expect(result.t).toBe(1);
    });

    it('closestPointOnSegment handles zero-length segment', () => {
      const result = closestPointOnSegment(
        { x: 5, y: 5 },
        { x: 3, y: 3 },
        { x: 3, y: 3 }
      );
      expect(result.t).toBe(0);
      expect(result.x).toBe(3);
      expect(result.y).toBe(3);
    });
  });

  describe('snap helpers', () => {
    it('snapToGrid rounds to nearest grid size', () => {
      expect(snapToGrid(23, 10)).toBe(20);
      expect(snapToGrid(27, 10)).toBe(30);
      expect(snapToGrid(0, 10)).toBe(0);
    });

    it('snapToAngle returns angle unchanged when not near snap point', () => {
      const input = (30 * Math.PI) / 180;
      expect(snapToAngle(input, [0, 45, 90], 5)).toBeCloseTo(input, 5);
    });

    it('snapToAngle snaps near a snap angle', () => {
      // 47 degrees should snap to 45 with default threshold of 5
      const input = (47 * Math.PI) / 180;
      const snapped = snapToAngle(input);
      expect(snapped).toBeCloseTo((45 * Math.PI) / 180, 5);
    });
  });

  describe('generateId', () => {
    it('includes the supplied prefix', () => {
      expect(generateId('v')).toMatch(/^v_/);
      expect(generateId('wall')).toMatch(/^wall_/);
    });

    it('produces unique IDs across calls', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) ids.add(generateId('x'));
      expect(ids.size).toBe(50);
    });
  });

  describe('calculateArtworkPosition', () => {
    it('returns position along wall as proportional interpolation', () => {
      const result = calculateArtworkPosition(
        SQUARE_WALLS[0],
        SQUARE_VERTICES,
        { x: 50, y: 50 },
        50, // halfway along wall
        150, // 1.5m from floor
        0 // flush with wall
      );
      expect(result.position.y).toBeCloseTo(1.5, 5);
      expect(typeof result.rotationY).toBe('number');
    });

    it('returns defaults when vertices missing', () => {
      const result = calculateArtworkPosition(
        { id: 'w', start_vertex: 'X', end_vertex: 'Y', height_cm: 300, openings: [] },
        SQUARE_VERTICES,
        { x: 0, y: 0 },
        50,
        150
      );
      expect(result.position.x).toBe(0);
      expect(result.rotationY).toBe(0);
    });
  });

  describe('constrainToWallBounds', () => {
    it('clamps x below minimum', () => {
      const result = constrainToWallBounds(-10, 100, 50, 50, 400, 300);
      expect(result.x).toBe(25); // artworkWidth / 2
    });

    it('clamps x above maximum', () => {
      const result = constrainToWallBounds(500, 100, 50, 50, 400, 300);
      expect(result.x).toBe(375); // wallLength - artworkWidth/2
    });

    it('passes through valid position', () => {
      const result = constrainToWallBounds(200, 150, 50, 50, 400, 300);
      expect(result).toEqual({ x: 200, y: 150 });
    });
  });
});
