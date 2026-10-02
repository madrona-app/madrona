import { useState, useRef, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import {
  Image,
  Upload,
  Trash2,
  Palette,
  Building2,
  FileSignature,
  AlertCircle,
  CheckCircle,
  Loader2,
} from 'lucide-react';
import {
  getOrganizationBranding,
  updateOrganizationBranding,
  uploadBrandingLogo,
  deleteBrandingLogo,
  uploadBrandingSignature,
  deleteBrandingSignature,
  type OrganizationBranding,
} from '../../lib/api';
import { useOrganization } from '../../contexts/useOrganization';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

export default function BrandingSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;
  const queryClient = useQueryClient();

  const logoInputRef = useRef<HTMLInputElement>(null);
  const signatureInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState<Partial<OrganizationBranding>>({});
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch branding
  const { data: branding, isLoading, error } = useQuery({
    queryKey: ['organization-branding', organizationId],
    queryFn: () => {
      if (!organizationId) throw new Error('No organization selected');
      return getOrganizationBranding(organizationId);
    },
    enabled: !!organizationId,
  });

  // Initialize form data when branding data is loaded
  useEffect(() => {
    if (branding) {
      setFormData(branding);
    }
  }, [branding]);

  // Update branding mutation
  const updateMutation = useMutation({
    mutationFn: (updates: Partial<OrganizationBranding>) => {
      if (!organizationId) throw new Error('No organization selected');
      return updateOrganizationBranding(organizationId, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-branding', organizationId] });
      setHasChanges(false);
    },
  });

  // Logo upload mutation
  const logoUploadMutation = useMutation({
    mutationFn: (file: File) => {
      if (!organizationId) throw new Error('No organization selected');
      return uploadBrandingLogo(organizationId, file);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-branding', organizationId] });
    },
  });

  // Logo delete mutation
  const logoDeleteMutation = useMutation({
    mutationFn: () => {
      if (!organizationId) throw new Error('No organization selected');
      return deleteBrandingLogo(organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-branding', organizationId] });
    },
  });

  // Signature upload mutation
  const signatureUploadMutation = useMutation({
    mutationFn: (file: File) => {
      if (!organizationId) throw new Error('No organization selected');
      return uploadBrandingSignature(organizationId, file);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-branding', organizationId] });
    },
  });

  // Signature delete mutation
  const signatureDeleteMutation = useMutation({
    mutationFn: () => {
      if (!organizationId) throw new Error('No organization selected');
      return deleteBrandingSignature(organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-branding', organizationId] });
    },
  });

  const handleInputChange = (field: keyof OrganizationBranding, value: string | null) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    updateMutation.mutate(formData);
  };

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      logoUploadMutation.mutate(file);
    }
    if (logoInputRef.current) {
      logoInputRef.current.value = '';
    }
  };

  const handleSignatureUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      signatureUploadMutation.mutate(file);
    }
    if (signatureInputRef.current) {
      signatureInputRef.current.value = '';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <MadronaLoader />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-md">
        <AlertCircle size={20} className="text-semantic-error mt-0.5" />
        <div>
          <p className="font-medium text-semantic-error">Failed to load branding settings</p>
          <p className="text-sm text-semantic-error">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-ink">Organization Branding</h1>
        <p className="text-sm text-accessible-gray mt-1">
          Configure your organization's branding for generated documents (loan agreements, receipts, etc.)
        </p>
      </div>

      {/* Logo Section */}
      <section className="bg-parchment rounded-lg border border-lichen shadow-sm mb-6">
        <div className="px-6 py-4 border-b border-lichen">
          <div className="flex items-center gap-2">
            <Image size={18} className="text-forest" />
            <h2 className="text-lg font-semibold text-ink">Logo</h2>
          </div>
          <p className="text-sm text-accessible-gray mt-1">
            Your organization's logo will appear on generated documents
          </p>
        </div>

        <div className="px-6 py-5">
          <div className="flex items-start gap-6">
            {/* Logo preview */}
            <div className="w-40 h-24 bg-stone/30 border border-lichen rounded-md flex items-center justify-center overflow-hidden">
              {branding?.logo_url ? (
                <img
                  src={branding.logo_url}
                  alt="Organization logo"
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <div className="text-center text-accessible-gray">
                  <Image size={32} className="mx-auto mb-1 opacity-50" />
                  <span className="text-xs">No logo</span>
                </div>
              )}
            </div>

            {/* Upload controls */}
            <div className="flex-1">
              <input
                ref={logoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/svg+xml,image/webp"
                onChange={handleLogoUpload}
                className="hidden"
              />

              <div className="flex items-center gap-2">
                <button
                  onClick={() => logoInputRef.current?.click()}
                  disabled={logoUploadMutation.isPending}
                  className="flex items-center gap-2 px-3 py-2 bg-forest text-parchment rounded-md hover:bg-forest/90 disabled:opacity-50 transition-colors text-sm"
                >
                  {logoUploadMutation.isPending ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Upload size={16} />
                  )}
                  Upload Logo
                </button>

                {branding?.logo_url && (
                  <button
                    onClick={() => logoDeleteMutation.mutate()}
                    disabled={logoDeleteMutation.isPending}
                    className="flex items-center gap-2 px-3 py-2 border border-semantic-error/30 text-semantic-error rounded-md hover:bg-semantic-error/20 disabled:opacity-50 transition-colors text-sm"
                  >
                    {logoDeleteMutation.isPending ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Trash2 size={16} />
                    )}
                    Remove
                  </button>
                )}
              </div>

              <p className="text-xs text-accessible-gray mt-2">
                Accepted formats: JPEG, PNG, SVG, WebP. Max size: 5MB
              </p>

              {logoUploadMutation.isError && (
                <div className="mt-2 text-sm text-semantic-error">
                  {logoUploadMutation.error instanceof Error
                    ? logoUploadMutation.error.message
                    : 'Failed to upload logo'}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Letterhead Section */}
      <section className="bg-parchment rounded-lg border border-lichen shadow-sm mb-6">
        <div className="px-6 py-4 border-b border-lichen">
          <div className="flex items-center gap-2">
            <Building2 size={18} className="text-forest" />
            <h2 className="text-lg font-semibold text-ink">Letterhead</h2>
          </div>
          <p className="text-sm text-accessible-gray mt-1">
            Organization details shown in document headers
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Organization Name
            </label>
            <input
              type="text"
              value={formData.letterhead_name || ''}
              onChange={(e) => handleInputChange('letterhead_name', e.target.value || null)}
              className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
              placeholder="Museum of Art"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Address Line 1
              </label>
              <input
                type="text"
                value={formData.letterhead_address_line1 || ''}
                onChange={(e) => handleInputChange('letterhead_address_line1', e.target.value || null)}
                className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                placeholder="123 Museum Way"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Address Line 2
              </label>
              <input
                type="text"
                value={formData.letterhead_address_line2 || ''}
                onChange={(e) => handleInputChange('letterhead_address_line2', e.target.value || null)}
                className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                placeholder="Suite 100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                City, State, ZIP
              </label>
              <input
                type="text"
                value={formData.letterhead_city_state_zip || ''}
                onChange={(e) => handleInputChange('letterhead_city_state_zip', e.target.value || null)}
                className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                placeholder="New York, NY 10001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Country
              </label>
              <input
                type="text"
                value={formData.letterhead_country || ''}
                onChange={(e) => handleInputChange('letterhead_country', e.target.value || null)}
                className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                placeholder="United States"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Phone
              </label>
              <input
                type="text"
                value={formData.letterhead_phone || ''}
                onChange={(e) => handleInputChange('letterhead_phone', e.target.value || null)}
                className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                placeholder="+1 (212) 555-0100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Email
              </label>
              <input
                type="email"
                value={formData.letterhead_email || ''}
                onChange={(e) => handleInputChange('letterhead_email', e.target.value || null)}
                className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                placeholder="info@museum.org"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Website
            </label>
            <input
              type="url"
              value={formData.letterhead_website || ''}
              onChange={(e) => handleInputChange('letterhead_website', e.target.value || null)}
              className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
              placeholder="https://www.museum.org"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Footer Text
            </label>
            <textarea
              value={formData.footer_text || ''}
              onChange={(e) => handleInputChange('footer_text', e.target.value || null)}
              rows={2}
              className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest resize-none"
              placeholder="Registered charity number: 12345678"
            />
            <p className="text-xs text-accessible-gray mt-1">
              This text appears at the bottom of each page
            </p>
          </div>
        </div>
      </section>

      {/* Colors Section */}
      <section className="bg-parchment rounded-lg border border-lichen shadow-sm mb-6">
        <div className="px-6 py-4 border-b border-lichen">
          <div className="flex items-center gap-2">
            <Palette size={18} className="text-forest" />
            <h2 className="text-lg font-semibold text-ink">Brand Colors</h2>
          </div>
          <p className="text-sm text-accessible-gray mt-1">
            Colors used in document headers and accents
          </p>
        </div>

        <div className="px-6 py-5">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Primary Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={formData.primary_color || '#1a365d'}
                  onChange={(e) => handleInputChange('primary_color', e.target.value)}
                  className="w-10 h-10 border border-lichen rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={formData.primary_color || '#1a365d'}
                  onChange={(e) => handleInputChange('primary_color', e.target.value)}
                  className="flex-1 px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest text-sm font-mono"
                  placeholder="#1a365d"
                />
              </div>
              <p className="text-xs text-accessible-gray mt-1">Main headings & headers</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Secondary Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={formData.secondary_color || 'rgb(var(--color-accessible-gray))'}
                  onChange={(e) => handleInputChange('secondary_color', e.target.value)}
                  className="w-10 h-10 border border-lichen rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={formData.secondary_color || 'rgb(var(--color-accessible-gray))'}
                  onChange={(e) => handleInputChange('secondary_color', e.target.value)}
                  className="flex-1 px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest text-sm font-mono"
                  placeholder="#2d3748"
                />
              </div>
              <p className="text-xs text-accessible-gray mt-1">Subheadings & labels</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Accent Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={formData.accent_color || '#3182ce'}
                  onChange={(e) => handleInputChange('accent_color', e.target.value)}
                  className="w-10 h-10 border border-lichen rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={formData.accent_color || '#3182ce'}
                  onChange={(e) => handleInputChange('accent_color', e.target.value)}
                  className="flex-1 px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest text-sm font-mono"
                  placeholder="#3182ce"
                />
              </div>
              <p className="text-xs text-accessible-gray mt-1">Links & highlights</p>
            </div>
          </div>
        </div>
      </section>

      {/* Signature Section */}
      <section className="bg-parchment rounded-lg border border-lichen shadow-sm mb-6">
        <div className="px-6 py-4 border-b border-lichen">
          <div className="flex items-center gap-2">
            <FileSignature size={18} className="text-forest" />
            <h2 className="text-lg font-semibold text-ink">Signature</h2>
          </div>
          <p className="text-sm text-accessible-gray mt-1">
            Default signature for official documents
          </p>
        </div>

        <div className="px-6 py-5">
          <div className="flex items-start gap-6 mb-4">
            {/* Signature preview */}
            <div className="w-40 h-16 bg-stone/30 border border-lichen rounded-md flex items-center justify-center overflow-hidden">
              {branding?.signature_url ? (
                <img
                  src={branding.signature_url}
                  alt="Signature"
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <div className="text-center text-accessible-gray">
                  <FileSignature size={24} className="mx-auto mb-1 opacity-50" />
                  <span className="text-xs">No signature</span>
                </div>
              )}
            </div>

            {/* Upload controls */}
            <div className="flex-1">
              <input
                ref={signatureInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleSignatureUpload}
                className="hidden"
              />

              <div className="flex items-center gap-2">
                <button
                  onClick={() => signatureInputRef.current?.click()}
                  disabled={signatureUploadMutation.isPending}
                  className="flex items-center gap-2 px-3 py-2 bg-forest text-parchment rounded-md hover:bg-forest/90 disabled:opacity-50 transition-colors text-sm"
                >
                  {signatureUploadMutation.isPending ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Upload size={16} />
                  )}
                  Upload Signature
                </button>

                {branding?.signature_url && (
                  <button
                    onClick={() => signatureDeleteMutation.mutate()}
                    disabled={signatureDeleteMutation.isPending}
                    className="flex items-center gap-2 px-3 py-2 border border-semantic-error/30 text-semantic-error rounded-md hover:bg-semantic-error/20 disabled:opacity-50 transition-colors text-sm"
                  >
                    {signatureDeleteMutation.isPending ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Trash2 size={16} />
                    )}
                    Remove
                  </button>
                )}
              </div>

              <p className="text-xs text-accessible-gray mt-2">
                PNG recommended for transparent background. Max size: 2MB
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Signatory Name
              </label>
              <input
                type="text"
                value={formData.signature_name || ''}
                onChange={(e) => handleInputChange('signature_name', e.target.value || null)}
                className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                placeholder="Jane Smith"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Signatory Title
              </label>
              <input
                type="text"
                value={formData.signature_title || ''}
                onChange={(e) => handleInputChange('signature_title', e.target.value || null)}
                className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                placeholder="Director of Collections"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Save Button */}
      <div className="flex items-center justify-between py-4">
        <div>
          {updateMutation.isSuccess && (
            <div className="flex items-center gap-2 text-semantic-success">
              <CheckCircle size={16} />
              <span className="text-sm">Settings saved successfully</span>
            </div>
          )}
          {updateMutation.isError && (
            <div className="flex items-center gap-2 text-semantic-error">
              <AlertCircle size={16} />
              <span className="text-sm">
                {updateMutation.error instanceof Error
                  ? updateMutation.error.message
                  : 'Failed to save settings'}
              </span>
            </div>
          )}
        </div>

        <button
          onClick={handleSave}
          disabled={!hasChanges || updateMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-forest text-parchment rounded-md hover:bg-forest/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {updateMutation.isPending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <CheckCircle size={16} />
          )}
          Save Changes
        </button>
      </div>
    </div>
  );
}
