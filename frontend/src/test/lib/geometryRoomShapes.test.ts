import { describe, it, expect } from 'vitest';
import {
  ROOM_SHAPE_PRESETS,
  generateRoomVertices,
  generateWallsFromVertices,
  createRoomGeometry,
  isConvexPolygon,
  validatePolygonGeometry,
  calculateWallThicknessVertices,
  splitWall,
  moveVertex,
  deleteVertex,
} from '../../lib/geometry/roomShapes';
import type { Vertex, PolygonGeometry } from '../../lib/geometry/polygonUtils';

describe('geometry/roomShapes', () => {
  describe('ROOM_SHAPE_PRESETS', () => {
    it('exposes all expected presets', () => {
      expect(ROOM_SHAPE_PRESETS.rectangular).toBeDefined();
      expect(ROOM_SHAPE_PRESETS.l_shape).toBeDefined();
      expect(ROOM_SHAPE_PRESETS.l_shape_mirror).toBeDefined();
      expect(ROOM_SHAPE_PRESETS.u_shape).toBeDefined();
      expect(ROOM_SHAPE_PRESETS.t_shape).toBeDefined();
      expect(ROOM_SHAPE_PRESETS.corner).toBeDefined();
      expect(ROOM_SHAPE_PRESETS.hexagonal).toBeDefined();
      expect(ROOM_SHAPE_PRESETS.octagonal).toBeDefined();
    });

    it('hasIndent is true for L/U/T shapes', () => {
      expect(ROOM_SHAPE_PRESETS.l_shape.hasIndent).toBe(true);
      expect(ROOM_SHAPE_PRESETS.u_shape.hasIndent).toBe(true);
      expect(ROOM_SHAPE_PRESETS.t_shape.hasIndent).toBe(true);
    });

    it('hasIndent is false for symmetric shapes', () => {
      expect(ROOM_SHAPE_PRESETS.rectangular.hasIndent).toBe(false);
      expect(ROOM_SHAPE_PRESETS.hexagonal.hasIndent).toBe(false);
      expect(ROOM_SHAPE_PRESETS.octagonal.hasIndent).toBe(false);
    });
  });

  describe('generateRoomVertices', () => {
    it('generates 4 vertices for rectangular', () => {
      const vertices = generateRoomVertices({
        preset: 'rectangular',
        width: 600,
        depth: 400,
        ceilingHeight: 300,
      });
      expect(vertices).toHaveLength(4);
      expect(vertices[0]).toEqual({ id: 'v1', x: 0, y: 0 });
      expect(vertices[2]).toEqual({ id: 'v3', x: 600, y: 400 });
    });

    it('generates 6 vertices for L-shape', () => {
      const vertices = generateRoomVertices({
        preset: 'l_shape',
        width: 600,
        depth: 400,
        ceilingHeight: 300,
      });
      expect(vertices).toHaveLength(6);
    });

    it('generates 6 vertices for L-shape mirror', () => {
      const vertices = generateRoomVertices({
        preset: 'l_shape_mirror',
        width: 600,
        depth: 400,
        ceilingHeight: 300,
      });
      expect(vertices).toHaveLength(6);
    });

    it('generates 8 vertices for U-shape', () => {
      const vertices = generateRoomVertices({
        preset: 'u_shape',
        width: 600,
        depth: 400,
        ceilingHeight: 300,
      });
      expect(vertices).toHaveLength(8);
    });

    it('generates 8 vertices for T-shape', () => {
      const vertices = generateRoomVertices({
        preset: 't_shape',
        width: 600,
        depth: 400,
        ceilingHeight: 300,
      });
      expect(vertices).toHaveLength(8);
    });

    it('generates 5 vertices for corner', () => {
      const vertices = generateRoomVertices({
        preset: 'corner',
        width: 500,
        depth: 500,
        ceilingHeight: 300,
      });
      expect(vertices).toHaveLength(5);
    });

    it('generates 6 vertices for hexagonal', () => {
      const vertices = generateRoomVertices({
        preset: 'hexagonal',
        width: 500,
        depth: 500,
        ceilingHeight: 300,
      });
      expect(vertices).toHaveLength(6);
    });

    it('generates 8 vertices for octagonal', () => {
      const vertices = generateRoomVertices({
        preset: 'octagonal',
        width: 500,
        depth: 500,
        ceilingHeight: 300,
      });
      expect(vertices).toHaveLength(8);
    });

    it('uses default indent dimensions when not provided (l_shape)', () => {
      const vertices = generateRoomVertices({
        preset: 'l_shape',
        width: 400,
        depth: 400,
        ceilingHeight: 300,
      });
      // indentWidth defaults to width/2 = 200, indentDepth = 200
      // vertex 4 at (width - indentWidth, depth - indentDepth) = (200, 200)
      expect(vertices[3]).toEqual({ id: 'v4', x: 200, y: 200 });
    });

    it('uses provided indent dimensions', () => {
      const vertices = generateRoomVertices({
        preset: 'l_shape',
        width: 400,
        depth: 400,
        indentWidth: 100,
        indentDepth: 100,
        ceilingHeight: 300,
      });
      expect(vertices[3]).toEqual({ id: 'v4', x: 300, y: 300 });
    });
  });

  describe('generateWallsFromVertices', () => {
    it('generates one wall per vertex', () => {
      const vertices: Vertex[] = [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 100, y: 0 },
        { id: 'v3', x: 100, y: 100 },
        { id: 'v4', x: 0, y: 100 },
      ];
      const walls = generateWallsFromVertices(vertices, 300);
      expect(walls).toHaveLength(4);
    });

    it('connects wraps from last vertex back to first', () => {
      const vertices: Vertex[] = [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 100, y: 0 },
        { id: 'v3', x: 0, y: 100 },
      ];
      const walls = generateWallsFromVertices(vertices, 300);
      expect(walls[2].start_vertex).toBe('v3');
      expect(walls[2].end_vertex).toBe('v1');
    });

    it('sets ceilingHeight on each wall', () => {
      const vertices: Vertex[] = [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 100, y: 0 },
        { id: 'v3', x: 100, y: 100 },
      ];
      const walls = generateWallsFromVertices(vertices, 250);
      walls.forEach((w) => expect(w.height_cm).toBe(250));
    });

    it('initializes openings as empty array', () => {
      const vertices: Vertex[] = [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 100, y: 0 },
        { id: 'v3', x: 100, y: 100 },
      ];
      const walls = generateWallsFromVertices(vertices, 250);
      walls.forEach((w) => expect(w.openings).toEqual([]));
    });
  });

  describe('createRoomGeometry', () => {
    it('produces a polygon geometry with vertices and matching walls', () => {
      const geom = createRoomGeometry({
        preset: 'rectangular',
        width: 500,
        depth: 400,
        ceilingHeight: 280,
      });
      expect(geom.type).toBe('polygon');
      expect(geom.vertices).toHaveLength(4);
      expect(geom.walls).toHaveLength(4);
      expect(geom.units).toBe('cm');
      expect(geom.columns).toEqual([]);
    });
  });

  describe('isConvexPolygon', () => {
    it('returns true for a square', () => {
      const square: Vertex[] = [
        { id: '1', x: 0, y: 0 },
        { id: '2', x: 100, y: 0 },
        { id: '3', x: 100, y: 100 },
        { id: '4', x: 0, y: 100 },
      ];
      expect(isConvexPolygon(square)).toBe(true);
    });

    it('returns true for a triangle', () => {
      const tri: Vertex[] = [
        { id: '1', x: 0, y: 0 },
        { id: '2', x: 100, y: 0 },
        { id: '3', x: 50, y: 100 },
      ];
      expect(isConvexPolygon(tri)).toBe(true);
    });

    it('returns false for L-shape (concave)', () => {
      const lShape: Vertex[] = [
        { id: '1', x: 0, y: 0 },
        { id: '2', x: 100, y: 0 },
        { id: '3', x: 100, y: 50 },
        { id: '4', x: 50, y: 50 },
        { id: '5', x: 50, y: 100 },
        { id: '6', x: 0, y: 100 },
      ];
      expect(isConvexPolygon(lShape)).toBe(false);
    });

    it('returns false for fewer than 3 vertices', () => {
      expect(isConvexPolygon([])).toBe(false);
      expect(isConvexPolygon([{ id: '1', x: 0, y: 0 }])).toBe(false);
      expect(
        isConvexPolygon([
          { id: '1', x: 0, y: 0 },
          { id: '2', x: 1, y: 1 },
        ]),
      ).toBe(false);
    });
  });



  describe('validatePolygonGeometry', () => {
    const validGeom: PolygonGeometry = {
      type: 'polygon',
      vertices: [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 500, y: 0 },
        { id: 'v3', x: 500, y: 500 },
        { id: 'v4', x: 0, y: 500 },
      ],
      walls: [
        { id: 'w1', start_vertex: 'v1', end_vertex: 'v2', height_cm: 300, openings: [] },
        { id: 'w2', start_vertex: 'v2', end_vertex: 'v3', height_cm: 300, openings: [] },
        { id: 'w3', start_vertex: 'v3', end_vertex: 'v4', height_cm: 300, openings: [] },
        { id: 'w4', start_vertex: 'v4', end_vertex: 'v1', height_cm: 300, openings: [] },
      ],
      columns: [],
      units: 'cm',
    };

    it('returns valid for a clean square', () => {
      const result = validatePolygonGeometry(validGeom);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('errors when fewer than 3 vertices', () => {
      const result = validatePolygonGeometry({
        ...validGeom,
        vertices: [{ id: 'v1', x: 0, y: 0 }],
        walls: [],
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('at least 3 vertices'))).toBe(true);
    });

    it('errors when vertices are duplicated', () => {
      const result = validatePolygonGeometry({
        ...validGeom,
        vertices: [
          { id: 'v1', x: 0, y: 0 },
          { id: 'v2', x: 100, y: 0 },
          { id: 'v3', x: 0, y: 0 }, // duplicate of v1
        ],
        walls: [
          { id: 'w1', start_vertex: 'v1', end_vertex: 'v2', height_cm: 300, openings: [] },
          { id: 'w2', start_vertex: 'v2', end_vertex: 'v3', height_cm: 300, openings: [] },
          { id: 'w3', start_vertex: 'v3', end_vertex: 'v1', height_cm: 300, openings: [] },
        ],
      });
      expect(result.errors.some((e) => e.includes('Duplicate vertex'))).toBe(true);
    });

    it('errors when wall count does not match vertex count', () => {
      const result = validatePolygonGeometry({
        ...validGeom,
        walls: [validGeom.walls[0]], // only 1 wall, 4 vertices
      });
      expect(result.errors.some((e) => e.includes('Number of walls'))).toBe(true);
    });

    it('errors when a wall references a missing vertex', () => {
      const result = validatePolygonGeometry({
        ...validGeom,
        walls: [
          { id: 'w1', start_vertex: 'v1', end_vertex: 'ghost', height_cm: 300, openings: [] },
          { id: 'w2', start_vertex: 'v2', end_vertex: 'v3', height_cm: 300, openings: [] },
          { id: 'w3', start_vertex: 'v3', end_vertex: 'v4', height_cm: 300, openings: [] },
          { id: 'w4', start_vertex: 'v4', end_vertex: 'v1', height_cm: 300, openings: [] },
        ],
      });
      expect(result.errors.some((e) => e.includes('missing vertex ghost'))).toBe(true);
    });

    it('warns on very small area (under 1 m²)', () => {
      const tiny: PolygonGeometry = {
        ...validGeom,
        vertices: [
          { id: 'v1', x: 0, y: 0 },
          { id: 'v2', x: 50, y: 0 },
          { id: 'v3', x: 50, y: 50 },
          { id: 'v4', x: 0, y: 50 },
        ],
      };
      const result = validatePolygonGeometry(tiny);
      expect(result.warnings.some((w) => w.includes('very small'))).toBe(true);
    });

    it('warns on concave polygons', () => {
      const concave: PolygonGeometry = {
        type: 'polygon',
        vertices: [
          { id: 'v1', x: 0, y: 0 },
          { id: 'v2', x: 1000, y: 0 },
          { id: 'v3', x: 1000, y: 500 },
          { id: 'v4', x: 500, y: 500 },
          { id: 'v5', x: 500, y: 1000 },
          { id: 'v6', x: 0, y: 1000 },
        ],
        walls: [
          { id: 'w1', start_vertex: 'v1', end_vertex: 'v2', height_cm: 300, openings: [] },
          { id: 'w2', start_vertex: 'v2', end_vertex: 'v3', height_cm: 300, openings: [] },
          { id: 'w3', start_vertex: 'v3', end_vertex: 'v4', height_cm: 300, openings: [] },
          { id: 'w4', start_vertex: 'v4', end_vertex: 'v5', height_cm: 300, openings: [] },
          { id: 'w5', start_vertex: 'v5', end_vertex: 'v6', height_cm: 300, openings: [] },
          { id: 'w6', start_vertex: 'v6', end_vertex: 'v1', height_cm: 300, openings: [] },
        ],
        columns: [],
        units: 'cm',
      };
      const result = validatePolygonGeometry(concave);
      expect(result.warnings.some((w) => w.includes('concave'))).toBe(true);
    });
  });

  describe('calculateWallThicknessVertices', () => {
    it('returns inner and outer arrays of equal length', () => {
      const geom = createRoomGeometry({
        preset: 'rectangular',
        width: 400,
        depth: 400,
        ceilingHeight: 300,
      });
      const { inner, outer } = calculateWallThicknessVertices(geom, 10);
      expect(inner).toHaveLength(geom.vertices.length);
      expect(outer).toHaveLength(geom.vertices.length);
    });

    it('produces ids suffixed with _inner and _outer', () => {
      const geom = createRoomGeometry({
        preset: 'rectangular',
        width: 400,
        depth: 400,
        ceilingHeight: 300,
      });
      const { inner, outer } = calculateWallThicknessVertices(geom, 10);
      expect(inner[0].id).toContain('_inner');
      expect(outer[0].id).toContain('_outer');
    });
  });

  describe('splitWall', () => {
    it('adds a vertex and replaces wall with two new walls', () => {
      const geom = createRoomGeometry({
        preset: 'rectangular',
        width: 400,
        depth: 400,
        ceilingHeight: 300,
      });
      const wallId = geom.walls[0].id;
      const updated = splitWall(geom, wallId, 0.5);
      expect(updated.vertices).toHaveLength(geom.vertices.length + 1);
      expect(updated.walls).toHaveLength(geom.walls.length + 1);
    });

    it('returns original geometry if wall id not found', () => {
      const geom = createRoomGeometry({
        preset: 'rectangular',
        width: 400,
        depth: 400,
        ceilingHeight: 300,
      });
      const updated = splitWall(geom, 'nonexistent', 0.5);
      expect(updated).toBe(geom);
    });
  });

  describe('moveVertex', () => {
    it('updates the position of the specified vertex', () => {
      const geom = createRoomGeometry({
        preset: 'rectangular',
        width: 400,
        depth: 400,
        ceilingHeight: 300,
      });
      const targetId = geom.vertices[0].id;
      const moved = moveVertex(geom, targetId, 50, 50);
      const v = moved.vertices.find((vx) => vx.id === targetId);
      expect(v?.x).toBe(50);
      expect(v?.y).toBe(50);
    });

    it('leaves other vertices unchanged', () => {
      const geom = createRoomGeometry({
        preset: 'rectangular',
        width: 400,
        depth: 400,
        ceilingHeight: 300,
      });
      const targetId = geom.vertices[0].id;
      const otherId = geom.vertices[1].id;
      const otherBefore = { ...geom.vertices[1] };
      const moved = moveVertex(geom, targetId, 50, 50);
      const other = moved.vertices.find((vx) => vx.id === otherId);
      expect(other?.x).toBe(otherBefore.x);
      expect(other?.y).toBe(otherBefore.y);
    });

    it('does not mutate input geometry', () => {
      const geom = createRoomGeometry({
        preset: 'rectangular',
        width: 400,
        depth: 400,
        ceilingHeight: 300,
      });
      const before = JSON.stringify(geom.vertices);
      moveVertex(geom, geom.vertices[0].id, 999, 999);
      expect(JSON.stringify(geom.vertices)).toBe(before);
    });
  });

  describe('deleteVertex', () => {
    it('refuses to delete when only 3 vertices remain', () => {
      const triangleGeom: PolygonGeometry = {
        type: 'polygon',
        vertices: [
          { id: 'v1', x: 0, y: 0 },
          { id: 'v2', x: 100, y: 0 },
          { id: 'v3', x: 50, y: 100 },
        ],
        walls: [
          { id: 'w1', start_vertex: 'v1', end_vertex: 'v2', height_cm: 300, openings: [] },
          { id: 'w2', start_vertex: 'v2', end_vertex: 'v3', height_cm: 300, openings: [] },
          { id: 'w3', start_vertex: 'v3', end_vertex: 'v1', height_cm: 300, openings: [] },
        ],
        columns: [],
        units: 'cm',
      };
      const result = deleteVertex(triangleGeom, 'v1');
      expect(result).toBe(triangleGeom);
    });

    it('removes a vertex and merges adjacent walls', () => {
      const geom = createRoomGeometry({
        preset: 'rectangular',
        width: 400,
        depth: 400,
        ceilingHeight: 300,
      });
      const targetId = geom.vertices[0].id;
      const result = deleteVertex(geom, targetId);
      expect(result.vertices).toHaveLength(geom.vertices.length - 1);
      // 4 walls minus 2 affected + 1 merged = 3
      expect(result.walls).toHaveLength(geom.walls.length - 1);
    });

    it('returns original geometry if vertex id not found', () => {
      const geom = createRoomGeometry({
        preset: 'rectangular',
        width: 400,
        depth: 400,
        ceilingHeight: 300,
      });
      const result = deleteVertex(geom, 'ghost');
      expect(result).toBe(geom);
    });
  });
});
