/**
 * Content CMS API client — pages, posts, blocks, categories.
 */
import { apiFetch, buildQueryString, validate } from './_utils';
import { z } from 'zod';
import {
  ContentPageSchema,
  ContentBlockSchema,
  ContentCategorySchema,
  ContentMenuSchema,
  PageTreeNodeSchema,
  ContentRedirectSchema,
} from '../schemas';
import type {
  ContentPage,
  ContentBlock,
  ContentCategory,
  ContentMenu,
  CreatePageRequest,
  UpdatePageRequest,
  SaveBlocksRequest,
  SaveMenuRequest,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  PaginatedResponse,
  PageTreeNode,
  PublicMenu,
  MenuLocation,
} from '../../types/content';

// =============================================================================
// Public API (no auth, used by /c/{org} pages)
// =============================================================================

export async function getPublishedPages(
  orgSlug: string,
): Promise<PaginatedResponse<ContentPage>> {
  const data = await apiFetch(`/content/${orgSlug}/pages`, { skipAuth: true });
  return validate(z.object({ data: z.array(ContentPageSchema), total: z.number() }).passthrough(), data) as unknown as PaginatedResponse<ContentPage>;
}

export async function getPublishedPage(
  orgSlug: string,
  pageSlug: string,
): Promise<{ data: ContentPage }> {
  const data = await apiFetch(`/content/${orgSlug}/pages/${pageSlug}`, { skipAuth: true });
  return validate(z.object({ data: ContentPageSchema }).passthrough(), data) as unknown as { data: ContentPage };
}

export async function getPublishedPosts(
  orgSlug: string,
  params: { limit?: number; offset?: number; category?: string } = {},
): Promise<PaginatedResponse<ContentPage>> {
  const query = buildQueryString(params);
  const data = await apiFetch(`/content/${orgSlug}/posts${query}`, { skipAuth: true });
  return validate(z.object({ data: z.array(ContentPageSchema), total: z.number() }).passthrough(), data) as unknown as PaginatedResponse<ContentPage>;
}

export async function getPublishedPost(
  orgSlug: string,
  postSlug: string,
): Promise<{ data: ContentPage }> {
  const data = await apiFetch(`/content/${orgSlug}/posts/${postSlug}`, { skipAuth: true });
  return validate(z.object({ data: ContentPageSchema }).passthrough(), data) as unknown as { data: ContentPage };
}

export async function getPublicCategories(
  orgSlug: string,
): Promise<PaginatedResponse<ContentCategory>> {
  const data = await apiFetch(`/content/${orgSlug}/categories`, { skipAuth: true });
  return validate(z.object({ data: z.array(ContentCategorySchema), total: z.number() }).passthrough(), data) as unknown as PaginatedResponse<ContentCategory>;
}

export async function getPublicMenu(
  orgSlug: string,
  location: MenuLocation,
): Promise<{ data: PublicMenu }> {
  const data = await apiFetch(`/content/${orgSlug}/menus/${location}`, { skipAuth: true });
  return validate(z.object({ data: z.object({ location: z.string(), items: z.array(z.object({}).passthrough()) }).passthrough() }).passthrough(), data) as unknown as { data: PublicMenu };
}

export async function getPublishedPageById(
  orgSlug: string,
  pageId: string,
): Promise<{ data: ContentPage }> {
  const data = await apiFetch(`/content/${orgSlug}/pages/by-id/${pageId}`, { skipAuth: true });
  return validate(z.object({ data: ContentPageSchema }).passthrough(), data) as unknown as { data: ContentPage };
}

export async function getPreviewPage(
  orgSlug: string,
  pageId: string,
  token: string,
  expires: string,
): Promise<{ data: ContentPage }> {
  const params = new URLSearchParams({ token, expires });
  const data = await apiFetch(`/content/${orgSlug}/preview/${pageId}?${params}`, { skipAuth: true });
  return validate(z.object({ data: ContentPageSchema }).passthrough(), data) as unknown as { data: ContentPage };
}

// =============================================================================
// Admin API (authenticated)
// =============================================================================

export async function listPages(
  organizationId: string,
  params: {
    page_type?: string;
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ items: ContentPage[]; total: number }> {
  const query = buildQueryString(params);
  const data = await apiFetch(`/organizations/${organizationId}/content/pages${query}`);
  return validate(z.object({ items: z.array(ContentPageSchema), total: z.number() }).passthrough(), data) as unknown as { items: ContentPage[]; total: number };
}

export async function getPage(
  organizationId: string,
  pageId: string,
): Promise<{ data: ContentPage }> {
  const data = await apiFetch(`/organizations/${organizationId}/content/pages/${pageId}`);
  return validate(z.object({ data: ContentPageSchema }).passthrough(), data) as unknown as { data: ContentPage };
}

export async function createPage(
  organizationId: string,
  body: CreatePageRequest,
): Promise<{ data: ContentPage }> {
  const data = await apiFetch(`/organizations/${organizationId}/content/pages`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return validate(z.object({ data: ContentPageSchema }).passthrough(), data) as unknown as { data: ContentPage };
}

export async function updatePage(
  organizationId: string,
  pageId: string,
  body: UpdatePageRequest,
): Promise<{ data: ContentPage }> {
  const data = await apiFetch(`/organizations/${organizationId}/content/pages/${pageId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return validate(z.object({ data: ContentPageSchema }).passthrough(), data) as unknown as { data: ContentPage };
}

export async function deletePage(
  organizationId: string,
  pageId: string,
): Promise<void> {
  await apiFetch(`/organizations/${organizationId}/content/pages/${pageId}`, {
    method: 'DELETE',
  });
}

export async function saveBlocks(
  organizationId: string,
  pageId: string,
  body: SaveBlocksRequest,
): Promise<{ data: ContentBlock[] }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/content/pages/${pageId}/blocks`,
    {
      method: 'PUT',
      body: JSON.stringify(body),
    },
  );
  return validate(z.object({ data: z.array(ContentBlockSchema) }).passthrough(), data) as unknown as { data: ContentBlock[] };
}

export async function publishPage(
  organizationId: string,
  pageId: string,
  publishAt?: string | null,
): Promise<{ data: ContentPage }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/content/pages/${pageId}/publish`,
    {
      method: 'POST',
      ...(publishAt ? { body: JSON.stringify({ publish_at: publishAt }) } : {}),
    },
  );
  return validate(z.object({ data: ContentPageSchema }).passthrough(), data) as unknown as { data: ContentPage };
}

export async function unpublishPage(
  organizationId: string,
  pageId: string,
): Promise<{ data: ContentPage }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/content/pages/${pageId}/unpublish`,
    { method: 'POST' },
  );
  return validate(z.object({ data: ContentPageSchema }).passthrough(), data) as unknown as { data: ContentPage };
}

// =============================================================================
// Categories Admin
// =============================================================================

export async function listCategories(
  organizationId: string,
): Promise<{ data: ContentCategory[] }> {
  const data = await apiFetch(`/organizations/${organizationId}/content/categories`);
  return validate(z.object({ data: z.array(ContentCategorySchema) }).passthrough(), data) as unknown as { data: ContentCategory[] };
}

export async function createCategory(
  organizationId: string,
  body: CreateCategoryRequest,
): Promise<{ data: ContentCategory }> {
  const data = await apiFetch(`/organizations/${organizationId}/content/categories`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return validate(z.object({ data: ContentCategorySchema }).passthrough(), data) as unknown as { data: ContentCategory };
}

export async function updateCategory(
  organizationId: string,
  categoryId: string,
  body: UpdateCategoryRequest,
): Promise<{ data: ContentCategory }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/content/categories/${categoryId}`,
    {
      method: 'PUT',
      body: JSON.stringify(body),
    },
  );
  return validate(z.object({ data: ContentCategorySchema }).passthrough(), data) as unknown as { data: ContentCategory };
}

export async function deleteCategory(
  organizationId: string,
  categoryId: string,
): Promise<void> {
  await apiFetch(
    `/organizations/${organizationId}/content/categories/${categoryId}`,
    { method: 'DELETE' },
  );
}

// =============================================================================
// Menus Admin
// =============================================================================

export async function getMenu(
  organizationId: string,
  location: MenuLocation,
): Promise<{ data: ContentMenu }> {
  const data = await apiFetch(`/organizations/${organizationId}/content/menus/${location}`);
  return validate(z.object({ data: ContentMenuSchema }).passthrough(), data) as unknown as { data: ContentMenu };
}

export async function saveMenu(
  organizationId: string,
  location: MenuLocation,
  body: SaveMenuRequest,
): Promise<{ data: ContentMenu }> {
  const data = await apiFetch(`/organizations/${organizationId}/content/menus/${location}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return validate(z.object({ data: ContentMenuSchema }).passthrough(), data) as unknown as { data: ContentMenu };
}

export async function deleteMenu(
  organizationId: string,
  location: MenuLocation,
): Promise<void> {
  await apiFetch(`/organizations/${organizationId}/content/menus/${location}`, {
    method: 'DELETE',
  });
}

// =============================================================================
// Page Tree
// =============================================================================

export async function getPageTree(
  organizationId: string,
): Promise<{ data: PageTreeNode[] }> {
  const data = await apiFetch(`/organizations/${organizationId}/content/pages/tree`);
  return validate(z.object({ data: z.array(PageTreeNodeSchema) }).passthrough(), data) as unknown as { data: PageTreeNode[] };
}

// =============================================================================
// Preview Token
// =============================================================================

export async function getPreviewToken(
  organizationId: string,
  pageId: string,
): Promise<{ data: { preview_token: string; preview_expires: string; page_id: string } }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/content/pages/${pageId}/preview-token`,
    { method: 'POST' },
  );
  return validate(z.object({ data: z.object({ preview_token: z.string(), preview_expires: z.string(), page_id: z.string() }) }).passthrough(), data);
}

// =============================================================================
// Redirects Admin
// =============================================================================

export interface Redirect {
  redirect_id: string;
  source_path: string;
  target_path: string;
  redirect_type: number;
  is_active: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export async function listRedirects(
  organizationId: string,
  params: { limit?: number; offset?: number } = {},
): Promise<{ items: Redirect[]; total: number }> {
  const query = buildQueryString(params);
  const data = await apiFetch(`/organizations/${organizationId}/content/redirects${query}`);
  return validate(z.object({ items: z.array(ContentRedirectSchema), total: z.number() }).passthrough(), data) as any;
}

export async function createRedirect(
  organizationId: string,
  body: {
    source_path: string;
    target_path: string;
    redirect_type?: number;
    is_active?: boolean;
    note?: string;
  },
): Promise<{ data: Redirect }> {
  const data = await apiFetch(`/organizations/${organizationId}/content/redirects`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return validate(z.object({ data: ContentRedirectSchema }).passthrough(), data) as any;
}

export async function updateRedirect(
  organizationId: string,
  redirectId: string,
  body: {
    source_path?: string;
    target_path?: string;
    redirect_type?: number;
    is_active?: boolean;
    note?: string;
  },
): Promise<{ data: Redirect }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/content/redirects/${redirectId}`,
    {
      method: 'PUT',
      body: JSON.stringify(body),
    },
  );
  return validate(z.object({ data: ContentRedirectSchema }).passthrough(), data) as any;
}

export async function deleteRedirect(
  organizationId: string,
  redirectId: string,
): Promise<void> {
  await apiFetch(
    `/organizations/${organizationId}/content/redirects/${redirectId}`,
    { method: 'DELETE' },
  );
}
