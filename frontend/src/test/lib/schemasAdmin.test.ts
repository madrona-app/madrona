import { describe, it, expect } from 'vitest';
import {
  OrganizationSchema,
  OrganizationMembershipSchema,
  DepartmentSchema,
  DepartmentMembershipSchema,
  CurrentUserSchema,
  OrganizationUserSchema,
  OrgRoleSchema,
  RolesResponseSchema,
  TimezonesResponseSchema,
  EmailEventSchema,
  EmailEventStatsSchema,
  OverviewPreferencesSchema,
  UserProfileResponseSchema,
  PageDocSchema,
  OrganizationBrandingSchema,
  DocumentTemplateSchema,
  FieldAccessPolicySchema,
  FieldAccessGrantSchema,
} from '../../lib/schemas/admin';

describe('schemas/admin', () => {
  describe('OrganizationSchema', () => {
    it('parses a minimal organization', () => {
      const result = OrganizationSchema.parse({
        organization_id: 'org-1',
        name: 'Test',
        slug: 'test',
        created_at: '2026-01-01T00:00:00Z',
      });
      // timezone has default 'UTC'
      expect(result.timezone).toBe('UTC');
    });

    it('accepts a custom timezone', () => {
      const result = OrganizationSchema.parse({
        organization_id: 'org-1',
        name: 'Test',
        slug: 'test',
        timezone: 'America/New_York',
        created_at: '2026-01-01T00:00:00Z',
      });
      expect(result.timezone).toBe('America/New_York');
    });

    it('rejects when organization_id is missing', () => {
      const result = OrganizationSchema.safeParse({
        name: 'Test',
        slug: 'test',
        created_at: '2026-01-01T00:00:00Z',
      });
      expect(result.success).toBe(false);
    });

    it('rejects when name is wrong type', () => {
      const result = OrganizationSchema.safeParse({
        organization_id: 'org-1',
        name: 123,
        slug: 'test',
        created_at: '2026-01-01T00:00:00Z',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes('name'))).toBe(true);
      }
    });
  });

  describe('OrganizationMembershipSchema', () => {
    it('accepts owner/admin/member roles', () => {
      for (const role of ['owner', 'admin', 'member'] as const) {
        const result = OrganizationMembershipSchema.safeParse({
          organization_id: 'org-1',
          name: 'X',
          slug: 'x',
          role,
          role_label: 'Label',
        });
        expect(result.success).toBe(true);
      }
    });

    it('rejects unknown roles', () => {
      const result = OrganizationMembershipSchema.safeParse({
        organization_id: 'org-1',
        name: 'X',
        slug: 'x',
        role: 'guest',
        role_label: 'Label',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('DepartmentSchema', () => {
    it('parses valid department', () => {
      const result = DepartmentSchema.parse({
        department_id: 'd-1',
        organization_id: 'org-1',
        name: 'IT',
        code: 'IT',
        path: 'IT',
        depth: 0,
        sort_order: 0,
        is_active: true,
        member_count: 0,
      });
      expect(result.name).toBe('IT');
    });

    it('allows optional parent_id and color', () => {
      const result = DepartmentSchema.parse({
        department_id: 'd-1',
        organization_id: 'org-1',
        name: 'Sub',
        code: 'SUB',
        path: 'IT.SUB',
        depth: 1,
        parent_id: 'd-0',
        color: '#ff0000',
        sort_order: 1,
        is_active: true,
        member_count: 5,
      });
      expect(result.parent_id).toBe('d-0');
      expect(result.color).toBe('#ff0000');
    });
  });

  describe('DepartmentMembershipSchema', () => {
    it('accepts admin/curator/editor/viewer roles', () => {
      for (const role of ['admin', 'curator', 'editor', 'viewer'] as const) {
        const result = DepartmentMembershipSchema.safeParse({
          membership_id: 'm-1',
          department_id: 'd-1',
          department_name: 'IT',
          department_code: 'IT',
          role,
          is_primary: true,
        });
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid role', () => {
      const result = DepartmentMembershipSchema.safeParse({
        membership_id: 'm-1',
        department_id: 'd-1',
        department_name: 'IT',
        department_code: 'IT',
        role: 'owner',
        is_primary: true,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('CurrentUserSchema', () => {
    it('parses minimal user with empty memberships', () => {
      const result = CurrentUserSchema.parse({
        user_id: 'u-1',
        email: 'a@x.com',
        name: 'Alice',
        permissions: [],
        organizations: [],
      });
      // department_memberships defaults to []
      expect(result.department_memberships).toEqual([]);
    });

    it('rejects when permissions is not an array', () => {
      const result = CurrentUserSchema.safeParse({
        user_id: 'u-1',
        email: 'a@x.com',
        name: 'Alice',
        permissions: 'admin',
        organizations: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('OrganizationUserSchema', () => {
    it('passes through extra keys', () => {
      const result = OrganizationUserSchema.parse({
        membership_id: 'm-1',
        user_id: 'u-1',
        email: 'a@x.com',
        role_id: 'r-1',
        role_key: 'admin',
        role_display_name: 'Administrator',
        status: 'active',
        user_status: 'active',
        created_at: '2026-01-01T00:00:00Z',
        extra_field: 'preserved',
      }) as Record<string, unknown>;
      expect(result.extra_field).toBe('preserved');
    });
  });

  describe('OrgRoleSchema', () => {
    it('parses valid role', () => {
      const result = OrgRoleSchema.parse({
        role_id: 'r-1',
        role_key: 'admin',
        display_name: 'Administrator',
      });
      expect(result.role_key).toBe('admin');
    });
  });

  describe('RolesResponseSchema', () => {
    it('parses empty roles list', () => {
      const result = RolesResponseSchema.parse({ roles: [] });
      expect(result.roles).toEqual([]);
    });
  });

  describe('TimezonesResponseSchema', () => {
    it('accepts an array of strings', () => {
      const result = TimezonesResponseSchema.parse({
        timezones: ['UTC', 'America/New_York'],
      });
      expect(result.timezones).toContain('UTC');
    });

    it('rejects non-string entries', () => {
      const result = TimezonesResponseSchema.safeParse({
        timezones: ['UTC', 123],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('EmailEventSchema', () => {
    it('parses minimal event', () => {
      const result = EmailEventSchema.parse({
        event_id: 'e-1',
        email: 'a@x.com',
        event_type: 'bounce',
        created_at: '2026-01-01T00:00:00Z',
      });
      expect(result.event_id).toBe('e-1');
    });
  });

  describe('EmailEventStatsSchema', () => {
    it('parses stats with both sections', () => {
      const result = EmailEventStatsSchema.parse({
        last_30_days: { bounces: 1, complaints: 2, total_events: 3 },
        user_email_status: { active: 10, bounced: 1, complaint: 0, total: 11 },
      });
      expect(result.last_30_days.bounces).toBe(1);
    });
  });

  describe('OverviewPreferencesSchema', () => {
    it('parses with just visible_dataset_ids', () => {
      const result = OverviewPreferencesSchema.parse({
        visible_dataset_ids: ['ds-1'],
      });
      expect(result.visible_dataset_ids).toEqual(['ds-1']);
    });
  });

  describe('UserProfileResponseSchema', () => {
    it('parses required + optional fields', () => {
      const result = UserProfileResponseSchema.parse({
        user_id: 'u-1',
        email: 'a@x.com',
        name: 'Alice',
        message: 'updated',
      });
      expect(result.message).toBe('updated');
    });
  });

  describe('PageDocSchema', () => {
    it('parses doc with markdown body', () => {
      const result = PageDocSchema.parse({
        doc_id: 'd-1',
        organization_id: 'org-1',
        page_key: 'home',
        title: 'Home',
        body_markdown: '# Hello',
        audience: 'all',
      });
      expect(result.body_markdown).toBe('# Hello');
    });
  });

  describe('OrganizationBrandingSchema', () => {
    it('parses with required color fields', () => {
      const result = OrganizationBrandingSchema.parse({
        organization_id: 'org-1',
        primary_color: '#000',
        secondary_color: '#fff',
        accent_color: '#888',
      });
      expect(result.primary_color).toBe('#000');
    });
  });

  describe('DocumentTemplateSchema', () => {
    it('parses template', () => {
      const result = DocumentTemplateSchema.parse({
        template_id: 't-1',
        template_type: 'condition_report',
        name: 'Default',
        is_default: true,
        is_active: true,
        is_system: false,
        config: {},
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      });
      expect(result.template_type).toBe('condition_report');
    });
  });

  describe('FieldAccessPolicySchema and FieldAccessGrantSchema', () => {
    it('parses a policy', () => {
      const result = FieldAccessPolicySchema.parse({
        policy_id: 'p-1',
        entity_type: 'object',
        field_path: 'price',
        policy_type: 'restricted',
        display_name: 'Price',
        default_visible: false,
      });
      expect(result.field_path).toBe('price');
    });

    it('parses a grant with view/edit booleans', () => {
      const result = FieldAccessGrantSchema.parse({
        policy_id: 'p-1',
        entity_type: 'object',
        field_path: 'price',
        can_view: true,
        can_edit: false,
      });
      expect(result.can_view).toBe(true);
      expect(result.can_edit).toBe(false);
    });
  });
});
