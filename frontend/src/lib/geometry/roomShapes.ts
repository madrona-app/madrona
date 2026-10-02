/**
 * Room Shape Presets and Geometry Builder
 *
 * Provides:
 * - Pre-built room shapes (L-shape, U-shape, T-shape, etc.)
 * - Geometry validation for complex polygons
 * - Concave polygon handling
 * - Wall thickness calculations
 */
import {
  type PolygonGeometry,
  type Vertex,
  type Wall,
  generateId,
  calculatePolygonArea,
} from './polygonUtils';

export type RoomShapePreset =
  | 'rectangular'
  | 'l_shape'
  | 'l_shape_mirror'
  | 'u_shape'
  | 't_shape'
  | 'corner'
  | 'hexagonal'
  | 'octagonal';

export interface RoomShapeConfig {
  preset: RoomShapePreset;
  // Primary dimensions (cm)
  width: number;
  depth: number;
  // For L/U/T shapes - the indent dimensions
  indentWidth?: number;
  indentDepth?: number;
  // Wall height
  ceilingHeight: number;
}

interface ShapePresetInfo {
  label: string;
  description: string;
  minVertices: number;
  hasIndent: boolean;
}

export const ROOM_SHAPE_PRESETS: Record<RoomShapePreset, ShapePresetInfo> = {
  rectangular: {
    label: 'Rectangular',
    description: 'Simple four-wall room',
    minVertices: 4,
    hasIndent: false,
  },
  l_shape: {
    label: 'L-Shape',
    description: 'L-shaped room with corner cutout',
    minVertices: 6,
    hasIndent: true,
  },
  l_shape_mirror: {
    label: 'L-Shape (Mirror)',
    description: 'L-shaped room, mirrored orientation',
    minVertices: 6,
    hasIndent: true,
  },
  u_shape: {
    label: 'U-Shape',
    description: 'U-shaped room with center alcove',
    minVertices: 8,
    hasIndent: true,
  },
  t_shape: {
    label: 'T-Shape',
    description: 'T-shaped room with wing',
    minVertices: 8,
    hasIndent: true,
  },
  corner: {
    label: 'Corner',
    description: 'Corner gallery with diagonal wall',
    minVertices: 5,
    hasIndent: false,
  },
  hexagonal: {
    label: 'Hexagonal',
    description: 'Six-sided room',
    minVertices: 6,
    hasIndent: false,
  },
  octagonal: {
    label: 'Octagonal',
    description: 'Eight-sided room',
    minVertices: 8,
    hasIndent: false,
  },
};

/**
 * Generate vertices for a room shape preset
 */
export function generateRoomVertices(config: RoomShapeConfig): Vertex[] {
  const { preset, width, depth, indentWidth = width / 2, indentDepth = depth / 2 } = config;

  switch (preset) {
    case 'rectangular':
      return [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: width, y: 0 },
        { id: 'v3', x: width, y: depth },
        { id: 'v4', x: 0, y: depth },
      ];

    case 'l_shape':
      // L-shape with cutout in top-right corner
      return [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: width, y: 0 },
        { id: 'v3', x: width, y: depth - indentDepth },
        { id: 'v4', x: width - indentWidth, y: depth - indentDepth },
        { id: 'v5', x: width - indentWidth, y: depth },
        { id: 'v6', x: 0, y: depth },
      ];

    case 'l_shape_mirror':
      // L-shape with cutout in top-left corner
      return [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: width, y: 0 },
        { id: 'v3', x: width, y: depth },
        { id: 'v4', x: indentWidth, y: depth },
        { id: 'v5', x: indentWidth, y: depth - indentDepth },
        { id: 'v6', x: 0, y: depth - indentDepth },
      ];

    case 'u_shape': {
      // U-shape with center cutout at top
      const uIndentStart = (width - indentWidth) / 2;
      return [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: width, y: 0 },
        { id: 'v3', x: width, y: depth },
        { id: 'v4', x: uIndentStart + indentWidth, y: depth },
        { id: 'v5', x: uIndentStart + indentWidth, y: depth - indentDepth },
        { id: 'v6', x: uIndentStart, y: depth - indentDepth },
        { id: 'v7', x: uIndentStart, y: depth },
        { id: 'v8', x: 0, y: depth },
      ];
    }

    case 't_shape': {
      // T-shape with wing extending from center
      const tWingStart = (width - indentWidth) / 2;
      return [
        { id: 'v1', x: tWingStart, y: 0 },
        { id: 'v2', x: tWingStart + indentWidth, y: 0 },
        { id: 'v3', x: tWingStart + indentWidth, y: indentDepth },
        { id: 'v4', x: width, y: indentDepth },
        { id: 'v5', x: width, y: depth },
        { id: 'v6', x: 0, y: depth },
        { id: 'v7', x: 0, y: indentDepth },
        { id: 'v8', x: tWingStart, y: indentDepth },
      ];
    }

    case 'corner':
      // Corner room with diagonal cut
      return [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: width, y: 0 },
        { id: 'v3', x: width, y: depth - indentDepth },
        { id: 'v4', x: width - indentWidth, y: depth },
        { id: 'v5', x: 0, y: depth },
      ];

    case 'hexagonal': {
      const vertices: Vertex[] = [];
      const centerX = width / 2;
      const centerY = depth / 2;
      const radius = Math.min(width, depth) / 2;
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI * 2) / 6 - Math.PI / 2;
        vertices.push({
          id: `v${i + 1}`,
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        });
      }
      return vertices;
    }

    case 'octagonal': {
      const vertices: Vertex[] = [];
      const centerX = width / 2;
      const centerY = depth / 2;
      const radius = Math.min(width, depth) / 2;
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI * 2) / 8 - Math.PI / 2;
        vertices.push({
          id: `v${i + 1}`,
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        });
      }
      return vertices;
    }

    default:
      return [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: width, y: 0 },
        { id: 'v3', x: width, y: depth },
        { id: 'v4', x: 0, y: depth },
      ];
  }
}

/**
 * Generate walls connecting vertices in order
 */
export function generateWallsFromVertices(
  vertices: Vertex[],
  ceilingHeight: number
): Wall[] {
  const walls: Wall[] = [];

  for (let i = 0; i < vertices.length; i++) {
    const startVertex = vertices[i];
    const endVertex = vertices[(i + 1) % vertices.length];

    walls.push({
      id: `wall_${i + 1}`,
      start_vertex: startVertex.id,
      end_vertex: endVertex.id,
      height_cm: ceilingHeight,
      openings: [],
    });
  }

  return walls;
}

/**
 * Create a complete polygon geometry from a room shape config
 */
export function createRoomGeometry(config: RoomShapeConfig): PolygonGeometry {
  const vertices = generateRoomVertices(config);
  const walls = generateWallsFromVertices(vertices, config.ceilingHeight);

  return {
    type: 'polygon',
    vertices,
    walls,
    columns: [],
    units: 'cm',
  };
}

/**
 * Check if a polygon is convex
 */
export function isConvexPolygon(vertices: Vertex[]): boolean {
  if (vertices.length < 3) return false;

  let sign = 0;

  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % vertices.length];
    const v3 = vertices[(i + 2) % vertices.length];

    const cross = (v2.x - v1.x) * (v3.y - v2.y) - (v2.y - v1.y) * (v3.x - v2.x);

    if (cross !== 0) {
      if (sign === 0) {
        sign = cross > 0 ? 1 : -1;
      } else if ((cross > 0 ? 1 : -1) !== sign) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Check if vertices are in clockwise order
 */
export function isClockwise(vertices: Vertex[]): boolean {
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % vertices.length];
    sum += (v2.x - v1.x) * (v2.y + v1.y);
  }
  return sum > 0;
}

/**
 * Ensure vertices are in clockwise order (required for proper wall normals)
 */
export function ensureClockwise(vertices: Vertex[]): Vertex[] {
  if (isClockwise(vertices)) {
    return vertices;
  }
  return [...vertices].reverse();
}

/**
 * Validate a polygon geometry
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePolygonGeometry(geometry: PolygonGeometry): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check minimum vertices
  if (geometry.vertices.length < 3) {
    errors.push('Room must have at least 3 vertices');
  }

  // Check for duplicate vertices
  const vertexSet = new Set<string>();
  for (const v of geometry.vertices) {
    const key = `${v.x.toFixed(2)},${v.y.toFixed(2)}`;
    if (vertexSet.has(key)) {
      errors.push(`Duplicate vertex at (${v.x}, ${v.y})`);
    }
    vertexSet.add(key);
  }

  // Check for self-intersecting edges
  if (hasSelfIntersection(geometry.vertices)) {
    errors.push('Room shape has self-intersecting walls');
  }

  // Check minimum area
  const area = calculatePolygonArea(geometry.vertices);
  if (area < 10000) {
    // Less than 1 square meter
    warnings.push('Room area is very small (less than 1 m²)');
  }

  // Check wall count matches vertex count
  if (geometry.walls.length !== geometry.vertices.length) {
    errors.push('Number of walls must equal number of vertices');
  }

  // Check all walls reference valid vertices
  const vertexIds = new Set(geometry.vertices.map((v) => v.id));
  for (const wall of geometry.walls) {
    if (!vertexIds.has(wall.start_vertex)) {
      errors.push(`Wall ${wall.id} references missing vertex ${wall.start_vertex}`);
    }
    if (!vertexIds.has(wall.end_vertex)) {
      errors.push(`Wall ${wall.id} references missing vertex ${wall.end_vertex}`);
    }
  }

  // Check for convexity (warning, not error)
  if (!isConvexPolygon(geometry.vertices)) {
    warnings.push('Room shape is concave - some views may have visual artifacts');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check if a polygon has self-intersecting edges
 */
function hasSelfIntersection(vertices: Vertex[]): boolean {
  const n = vertices.length;

  for (let i = 0; i < n; i++) {
    const a1 = vertices[i];
    const a2 = vertices[(i + 1) % n];

    for (let j = i + 2; j < n; j++) {
      // Skip adjacent edges
      if (j === (i + n - 1) % n) continue;

      const b1 = vertices[j];
      const b2 = vertices[(j + 1) % n];

      if (segmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if two line segments intersect
 */
function segmentsIntersect(
  a1: Vertex,
  a2: Vertex,
  b1: Vertex,
  b2: Vertex
): boolean {
  const d1 = direction(b1, b2, a1);
  const d2 = direction(b1, b2, a2);
  const d3 = direction(a1, a2, b1);
  const d4 = direction(a1, a2, b2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return false;
}

function direction(p1: Vertex, p2: Vertex, p3: Vertex): number {
  return (p3.x - p1.x) * (p2.y - p1.y) - (p2.x - p1.x) * (p3.y - p1.y);
}

/**
 * Calculate wall thickness offset points for rendering
 */
export function calculateWallThicknessVertices(
  geometry: PolygonGeometry,
  wallThickness: number
): { inner: Vertex[]; outer: Vertex[] } {
  const inner: Vertex[] = [];
  const outer: Vertex[] = [];

  for (const vertex of geometry.vertices) {
    // Find adjacent walls
    const adjacentWalls = geometry.walls.filter(
      (w) => w.start_vertex === vertex.id || w.end_vertex === vertex.id
    );

    if (adjacentWalls.length < 2) {
      inner.push({ ...vertex, id: `${vertex.id}_inner` });
      outer.push({ ...vertex, id: `${vertex.id}_outer` });
      continue;
    }

    // Calculate bisector angle for the corner
    const angles: number[] = [];
    for (const wall of adjacentWalls) {
      const start = geometry.vertices.find((v) => v.id === wall.start_vertex)!;
      const end = geometry.vertices.find((v) => v.id === wall.end_vertex)!;

      if (wall.start_vertex === vertex.id) {
        angles.push(Math.atan2(end.y - vertex.y, end.x - vertex.x));
      } else {
        angles.push(Math.atan2(start.y - vertex.y, start.x - vertex.x));
      }
    }

    // Calculate bisector
    const bisector = (angles[0] + angles[1]) / 2 + Math.PI / 2;
    const offset = wallThickness / 2 / Math.sin(Math.abs(angles[1] - angles[0]) / 2);

    inner.push({
      id: `${vertex.id}_inner`,
      x: vertex.x - Math.cos(bisector) * offset,
      y: vertex.y - Math.sin(bisector) * offset,
    });

    outer.push({
      id: `${vertex.id}_outer`,
      x: vertex.x + Math.cos(bisector) * offset,
      y: vertex.y + Math.sin(bisector) * offset,
    });
  }

  return { inner, outer };
}

/**
 * Add a vertex to split a wall
 */
export function splitWall(
  geometry: PolygonGeometry,
  wallId: string,
  splitPosition: number // 0-1, position along wall
): PolygonGeometry {
  const wallIndex = geometry.walls.findIndex((w) => w.id === wallId);
  if (wallIndex === -1) return geometry;

  const wall = geometry.walls[wallIndex];
  const startVertex = geometry.vertices.find((v) => v.id === wall.start_vertex);
  const endVertex = geometry.vertices.find((v) => v.id === wall.end_vertex);

  if (!startVertex || !endVertex) return geometry;

  // Create new vertex at split position
  const newVertex: Vertex = {
    id: generateId('v'),
    x: startVertex.x + (endVertex.x - startVertex.x) * splitPosition,
    y: startVertex.y + (endVertex.y - startVertex.y) * splitPosition,
  };

  // Create two new walls
  const wall1: Wall = {
    id: generateId('wall'),
    start_vertex: wall.start_vertex,
    end_vertex: newVertex.id,
    height_cm: wall.height_cm,
    openings: [],
  };

  const wall2: Wall = {
    id: generateId('wall'),
    start_vertex: newVertex.id,
    end_vertex: wall.end_vertex,
    height_cm: wall.height_cm,
    openings: [],
  };

  // Insert new vertex
  const vertexIndex = geometry.vertices.findIndex((v) => v.id === endVertex.id);
  const newVertices = [...geometry.vertices];
  newVertices.splice(vertexIndex, 0, newVertex);

  // Replace old wall with two new walls
  const newWalls = [...geometry.walls];
  newWalls.splice(wallIndex, 1, wall1, wall2);

  return {
    ...geometry,
    vertices: newVertices,
    walls: newWalls,
  };
}

/**
 * Move a vertex to a new position
 */
export function moveVertex(
  geometry: PolygonGeometry,
  vertexId: string,
  newX: number,
  newY: number
): PolygonGeometry {
  return {
    ...geometry,
    vertices: geometry.vertices.map((v) =>
      v.id === vertexId ? { ...v, x: newX, y: newY } : v
    ),
  };
}

/**
 * Delete a vertex (merges adjacent walls)
 */
export function deleteVertex(
  geometry: PolygonGeometry,
  vertexId: string
): PolygonGeometry {
  if (geometry.vertices.length <= 3) {
    // Can't delete if only 3 vertices
    return geometry;
  }

  const vertexIndex = geometry.vertices.findIndex((v) => v.id === vertexId);
  if (vertexIndex === -1) return geometry;

  // Find walls that reference this vertex
  const affectedWalls = geometry.walls.filter(
    (w) => w.start_vertex === vertexId || w.end_vertex === vertexId
  );

  if (affectedWalls.length !== 2) {
    // Should always be exactly 2 for a valid polygon
    return geometry;
  }

  // Find the other vertices these walls connect to
  const otherVertices = affectedWalls.map((w) =>
    w.start_vertex === vertexId ? w.end_vertex : w.start_vertex
  );

  // Create merged wall
  const mergedWall: Wall = {
    id: generateId('wall'),
    start_vertex: otherVertices[0],
    end_vertex: otherVertices[1],
    height_cm: affectedWalls[0].height_cm,
    openings: [],
  };

  // Remove vertex and old walls, add merged wall
  const newVertices = geometry.vertices.filter((v) => v.id !== vertexId);
  const wallIdsToRemove = new Set(affectedWalls.map((w) => w.id));
  const newWalls = geometry.walls
    .filter((w) => !wallIdsToRemove.has(w.id))
    .concat(mergedWall);

  return {
    ...geometry,
    vertices: newVertices,
    walls: newWalls,
  };
}

export default {
  ROOM_SHAPE_PRESETS,
  createRoomGeometry,
  generateRoomVertices,
  generateWallsFromVertices,
  validatePolygonGeometry,
  isConvexPolygon,
  ensureClockwise,
  calculateWallThicknessVertices,
  splitWall,
  moveVertex,
  deleteVertex,
};
