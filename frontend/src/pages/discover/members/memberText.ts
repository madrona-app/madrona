import type { MemberCollectionItem } from '../../../lib/api/discoverMembers';

export function itemCountText(n: number): string {
  return n === 1 ? '1 object' : `${n} objects`;
}

export function objectTitle(item: MemberCollectionItem): string {
  return item.object.title || item.object.object_number || 'Untitled object';
}
