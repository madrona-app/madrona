/**
 * Shared drag state for cross-component drag-and-drop.
 *
 * The source (list page) and target (RecordSetStrip) live in different
 * React subtrees, so they can't share React state through a common
 * ancestor without a new context provider. And HTML5 dataTransfer
 * proved unreliable across browsers for custom MIME types.
 *
 * This module-level state is the simplest bridge. Source calls
 * setDragPayload() on dragstart; target calls getDragPayload() on drop.
 * Works because JavaScript modules are singletons within the bundle.
 */

export interface DragObjectPayload {
  kind: 'object';
  objectId: string;
  objectNumber: string;
  title: string;
}

export interface DragMediaPayload {
  kind: 'media';
  mediaId: string;
  filename: string;
  title: string;
}

export type DragPayload = DragObjectPayload | DragMediaPayload;

let _current: DragPayload | null = null;

export function setDragPayload(payload: DragPayload | null): void {
  _current = payload;
}

export function getDragPayload(): DragPayload | null {
  return _current;
}

export function clearDragPayload(): void {
  _current = null;
}
