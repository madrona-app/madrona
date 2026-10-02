import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { useQuery, useMutation } from '@tanstack/react-query';
import { updateUserProfile, updateOrganization, uploadAvatar, deleteAvatar, getOrganizationStorage } from '../../lib/api';
import { User, Building2, Mail, Shield, Edit2, Camera, Trash2, HardDrive, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ChangePasswordModal from '../../components/ChangePasswordModal';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { GuidePreferencesPanel } from '../../components/guide/GuidePreferencesPanel';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export const UserSettingsPage: React.FC = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  
  // Local state for editing name
  const [isEditingName, setIsEditingName] = useState(false);
  const [displayName, setDisplayName] = useState(auth.user?.name || '');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Track last known auth name to detect external changes
  const [lastAuthName, setLastAuthName] = useState(auth.user?.name || '');

  // Sync displayName with auth.user.name when it changes (render-time sync)
  if (!isEditingName && auth.user?.name !== lastAuthName) {
    setLastAuthName(auth.user?.name || '');
    setDisplayName(auth.user?.name || '');
  }
  
  // Local state for editing timezone
  const [isEditingTimezone, setIsEditingTimezone] = useState(false);
  const [timezone, setTimezone] = useState(auth.user?.timezone || 'America/New_York');
  const [timezoneSaveStatus, setTimezoneSaveStatus] = useState<SaveStatus>('idle');
  const [timezoneError, setTimezoneError] = useState<string | null>(null);
  
  // Local state for editing organization name
  const [isEditingOrgName, setIsEditingOrgName] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [orgNameSaveStatus, setOrgNameSaveStatus] = useState<SaveStatus>('idle');
  const [orgNameError, setOrgNameError] = useState<string | null>(null);

  // Local state for editing organization timezone
  const [isEditingOrgTimezone, setIsEditingOrgTimezone] = useState(false);
  const [orgTimezone, setOrgTimezone] = useState('UTC');
  const [orgTimezoneSaveStatus, setOrgTimezoneSaveStatus] = useState<SaveStatus>('idle');
  const [orgTimezoneError, setOrgTimezoneError] = useState<string | null>(null);

  // Check if user can manage organization settings
  const canManageSettings = hasPermission('org.manage_settings');

  // State for change password modal
  const [isChangePasswordModalOpen, setIsChangePasswordModalOpen] = useState(false);

  // State for avatar upload
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInputRef = React.useRef<HTMLInputElement>(null);

  const activeOrg = auth.memberships.find(
    (org) => org.organization_id === auth.activeOrganizationId
  );

  // Check if user has password-based authentication
  // If user has no password set (e.g., SSO-only), hide password change
  // Future enhancement: When backend returns auth_provider field in /me,
  // use auth.user?.auth_provider === 'password' to conditionally show this section
  const supportsPasswordAuth = true;

  // Fetch storage stats for active org
  const { data: storageStats, isLoading: storageLoading, error: storageError } = useQuery({
    queryKey: ['organization-storage', auth.activeOrganizationId],
    queryFn: () => {
      if (!auth.activeOrganizationId) throw new Error('No organization selected');
      return getOrganizationStorage(auth.activeOrganizationId);
    },
    enabled: !!auth.activeOrganizationId && canManageSettings,
  });

  // Track last known values for render-time sync
  const [lastOrgName, setLastOrgName] = useState(activeOrg?.name);
  const [lastOrgTimezone, setLastOrgTimezone] = useState(activeOrg?.timezone);

  // Sync org name when active org changes (render-time sync)
  if (activeOrg && !isEditingOrgName && activeOrg.name !== lastOrgName) {
    setLastOrgName(activeOrg.name);
    setOrgName(activeOrg.name);
  }

  // Sync org timezone when active org changes (render-time sync)
  if (activeOrg && !isEditingOrgTimezone && activeOrg.timezone !== lastOrgTimezone) {
    setLastOrgTimezone(activeOrg.timezone);
    setOrgTimezone(activeOrg.timezone || 'UTC');
  }

  // Mutation for updating user profile
  const updateProfileMutation = useMutation({
    mutationFn: updateUserProfile,
    onMutate: () => {
      setSaveStatus('saving');
      setSaveError(null);
    },
    onSuccess: () => {
      // Refresh the auth context to get updated user data
      auth.refreshMe();
      setIsEditingName(false);
      setSaveStatus('saved');
      setSaveError(null);
      
      // Auto-dismiss success message after 2 seconds
      setTimeout(() => {
        setSaveStatus('idle');
      }, 2000);
    },
    onError: (error: any) => {
      setSaveStatus('error');
      setSaveError(error?.message || 'Failed to update profile');
    },
  });

  const handleSaveName = () => {
    const trimmedName = displayName.trim();
    updateProfileMutation.mutate({ 
      display_name: trimmedName || null 
    });
  };

  const handleCancelEdit = () => {
    setDisplayName(auth.user?.name || '');
    setIsEditingName(false);
    setSaveError(null);
    setSaveStatus('idle');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && canSaveName) {
      e.preventDefault();
      handleSaveName();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  // Validation: enable save only if name changed and is valid
  const hasNameChanged = displayName.trim() !== (auth.user?.name || '');
  const canSaveName = hasNameChanged && !updateProfileMutation.isPending;

  // Timezone mutation
  const updateTimezoneMutation = useMutation({
    mutationFn: updateUserProfile,
    onMutate: () => {
      setTimezoneSaveStatus('saving');
      setTimezoneError(null);
    },
    onSuccess: () => {
      // Refresh the auth context to get updated user data
      auth.refreshMe();
      setIsEditingTimezone(false);
      setTimezoneSaveStatus('saved');
      setTimezoneError(null);
      
      // Auto-dismiss success message after 2 seconds
      setTimeout(() => {
        setTimezoneSaveStatus('idle');
      }, 2000);
    },
    onError: (error: any) => {
      setTimezoneSaveStatus('error');
      setTimezoneError(error?.message || 'Failed to update timezone');
    },
  });

  // Timezone handlers
  const handleTimezoneChange = (newTimezone: string) => {
    setTimezone(newTimezone);
    // Auto-save on change
    updateTimezoneMutation.mutate({ 
      timezone: newTimezone 
    });
  };

  const handleCancelTimezoneEdit = () => {
    setTimezone(auth.user?.timezone || 'America/New_York');
    setIsEditingTimezone(false);
    setTimezoneError(null);
    setTimezoneSaveStatus('idle');
  };

  // Avatar handlers
  const handleAvatarClick = () => {
    avatarInputRef.current?.click();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setAvatarError('Please upload a JPEG, PNG, GIF, or WebP image');
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('Image must be less than 5MB');
      return;
    }

    setAvatarUploading(true);
    setAvatarError(null);

    try {
      await uploadAvatar(file);
      // Refresh auth to get new avatar URL
      await auth.refreshMe();
    } catch (err: any) {
      setAvatarError(err.message || 'Failed to upload avatar');
    } finally {
      setAvatarUploading(false);
      // Reset the input so the same file can be selected again
      if (avatarInputRef.current) {
        avatarInputRef.current.value = '';
      }
    }
  };

  const handleDeleteAvatar = async () => {
    if (!auth.user?.avatar_url) return;

    setAvatarUploading(true);
    setAvatarError(null);

    try {
      await deleteAvatar();
      // Refresh auth to clear avatar URL
      await auth.refreshMe();
    } catch (err: any) {
      setAvatarError(err.message || 'Failed to delete avatar');
    } finally {
      setAvatarUploading(false);
    }
  };

  // Common US timezones for the dropdown
  const commonTimezones = [
    { value: 'America/New_York', label: 'Eastern Time (ET)' },
    { value: 'America/Chicago', label: 'Central Time (CT)' },
    { value: 'America/Denver', label: 'Mountain Time (MT)' },
    { value: 'America/Phoenix', label: 'Arizona (no DST)' },
    { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
    { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
    { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)' },
    { value: 'UTC', label: 'UTC' },
  ];

  // Mutation for updating organization name
  const updateOrgNameMutation = useMutation({
    mutationFn: ({ organizationId, updates }: { organizationId: string; updates: { name?: string } }) => 
      updateOrganization(organizationId, updates),
    onMutate: () => {
      setOrgNameSaveStatus('saving');
      setOrgNameError(null);
    },
    onSuccess: () => {
      // Refresh auth context to get updated org name
      auth.refreshMe();
      setIsEditingOrgName(false);
      setOrgNameSaveStatus('saved');
      setOrgNameError(null);
      
      // Auto-dismiss success message after 2 seconds
      setTimeout(() => {
        setOrgNameSaveStatus('idle');
      }, 2000);
    },
    onError: (error: any) => {
      setOrgNameSaveStatus('error');
      setOrgNameError(error?.message || 'Failed to update organization name');
    },
  });
  
  const handleSaveOrgName = () => {
    if (!auth.activeOrganizationId) return;
    const trimmedName = orgName.trim();
    updateOrgNameMutation.mutate({
      organizationId: auth.activeOrganizationId,
      updates: { name: trimmedName },
    });
  };
  
  const handleCancelOrgNameEdit = () => {
    setOrgName(activeOrg?.name || '');
    setIsEditingOrgName(false);
    setOrgNameError(null);
    setOrgNameSaveStatus('idle');
  };
  
  const handleOrgNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && canSaveOrgName) {
      e.preventDefault();
      handleSaveOrgName();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelOrgNameEdit();
    }
  };
  
  // Validation for org name
  const hasOrgNameChanged = orgName.trim() !== (activeOrg?.name || '');
  const isOrgNameValid = orgName.trim().length > 0 && orgName.trim().length <= 200;
  const canSaveOrgName = hasOrgNameChanged && isOrgNameValid && !updateOrgNameMutation.isPending;

  // Mutation for updating organization timezone
  const updateOrgTimezoneMutation = useMutation({
    mutationFn: ({ organizationId, updates }: { organizationId: string; updates: { timezone?: string } }) =>
      updateOrganization(organizationId, updates),
    onMutate: () => {
      setOrgTimezoneSaveStatus('saving');
      setOrgTimezoneError(null);
    },
    onSuccess: () => {
      auth.refreshMe();
      setIsEditingOrgTimezone(false);
      setOrgTimezoneSaveStatus('saved');
      setOrgTimezoneError(null);
      setTimeout(() => {
        setOrgTimezoneSaveStatus('idle');
      }, 2000);
    },
    onError: (error: any) => {
      setOrgTimezoneSaveStatus('error');
      setOrgTimezoneError(error?.message || 'Failed to update organization timezone');
    },
  });

  const handleOrgTimezoneChange = (newTimezone: string) => {
    if (!auth.activeOrganizationId) return;
    setOrgTimezone(newTimezone);
    updateOrgTimezoneMutation.mutate({
      organizationId: auth.activeOrganizationId,
      updates: { timezone: newTimezone },
    });
  };

  const handleCancelOrgTimezoneEdit = () => {
    setOrgTimezone(activeOrg?.timezone || 'UTC');
    setIsEditingOrgTimezone(false);
    setOrgTimezoneError(null);
    setOrgTimezoneSaveStatus('idle');
  };

  // Format GB as human-friendly string
  const formatStorageSize = (gb: number): string => {
    if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`;
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    return `${(gb * 1024).toFixed(0)} MB`;
  };

  // Timezone options for org timezone dropdown (same as user but with more international options)
  const orgTimezoneOptions = [
    { value: 'UTC', label: 'UTC' },
    // Americas
    { value: 'America/New_York', label: 'Eastern Time (ET)' },
    { value: 'America/Chicago', label: 'Central Time (CT)' },
    { value: 'America/Denver', label: 'Mountain Time (MT)' },
    { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
    { value: 'America/Phoenix', label: 'Arizona (no DST)' },
    { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
    { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)' },
    // Europe
    { value: 'Europe/London', label: 'London (GMT/BST)' },
    { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
    { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
    { value: 'Europe/Amsterdam', label: 'Amsterdam (CET/CEST)' },
    // Asia/Pacific
    { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
    { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
    { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
    { value: 'Asia/Dubai', label: 'Dubai (GST)' },
    { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
    { value: 'Australia/Melbourne', label: 'Melbourne (AEST/AEDT)' },
    { value: 'Pacific/Auckland', label: 'Auckland (NZST/NZDT)' },
  ];

  if (auth.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <MadronaLoader />
      </div>
    );
  }

  if (!auth.user) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-archive">Please log in to view settings</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ink">Account Settings</h1>
        <p className="text-archive mt-1">Personal and organizational configuration</p>
      </div>

      {/* ========================================
          SECTION 1: YOUR PROFILE (User-scoped)
          Always visible to logged-in users
          ======================================== */}
      <div className="mb-8">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-ink">Your Profile</h2>
          <p className="text-sm text-archive mt-1">Personal information visible to your organization</p>
        </div>

        {/* Profile completeness hint */}
        {(!auth.user.name || auth.user.name.trim() === '') && (
          <div className="mb-4 px-4 py-3 bg-stone-50 border border-stone-200 rounded text-sm text-stone-700">
            Add a display name to help your team identify you.
          </div>
        )}

        <div className="bg-parchment rounded-lg shadow border border-lichen">
          <div className="px-6 py-4 space-y-4">
            <div className="flex items-start gap-4">
              {/* Avatar with upload functionality */}
              <div className="relative flex-shrink-0 group">
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  onChange={handleAvatarChange}
                  className="hidden"
                  aria-label="Upload profile picture"
                />
                <div
                  className={`w-20 h-20 rounded-full flex items-center justify-center overflow-hidden cursor-pointer transition-opacity ${
                    avatarUploading ? 'opacity-50' : ''
                  }`}
                  onClick={handleAvatarClick}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleAvatarClick()}
                  aria-label="Click to upload profile picture"
                >
                  {auth.user?.avatar_url ? (
                    <img
                      src={auth.user.avatar_url}
                      alt={auth.user.name || 'Profile'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-stone-200 flex items-center justify-center">
                      <User size={32} className="text-stone-600" />
                    </div>
                  )}
                </div>
                {/* Hover overlay */}
                <div
                  className="absolute inset-0 rounded-full bg-ink/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  onClick={handleAvatarClick}
                >
                  <Camera size={20} className="text-parchment" />
                </div>
                {/* Delete button (only show if avatar exists) */}
                {auth.user?.avatar_url && !avatarUploading && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteAvatar();
                    }}
                    className="absolute -bottom-1 -right-1 w-6 h-6 bg-parchment border border-lichen rounded-full flex items-center justify-center shadow-sm hover:bg-semantic-error/10 hover:border-semantic-error/30 transition-colors"
                    title="Remove profile picture"
                    aria-label="Remove profile picture"
                  >
                    <Trash2 size={12} className="text-archive hover:text-semantic-error" />
                  </button>
                )}
                {/* Loading indicator */}
                {avatarUploading && (
                  <div className="absolute inset-0 rounded-full flex items-center justify-center">
                    <MadronaLoader variant="dots" />
                  </div>
                )}
              </div>
              <div className="flex-1">
                {/* Avatar error message */}
                {avatarError && (
                  <div className="mb-3 px-3 py-2 bg-semantic-error/10 border border-semantic-error/30 rounded text-sm text-semantic-error">
                    {avatarError}
                  </div>
                )}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-ink">Display name</label>
                    {!isEditingName && (
                      <button
                        onClick={() => {
                          setIsEditingName(true);
                          setSaveStatus('idle');
                          setSaveError(null);
                        }}
                        className="text-sm text-stone-600 hover:text-stone-800 flex items-center gap-1"
                      >
                        <Edit2 size={14} />
                        Edit
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    {isEditingName ? (
                      <>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onFocus={(e) => e.target.select()}
                            placeholder="Enter your display name"
                            className="flex-1 px-3 py-2 border border-lichen rounded-md focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-stone-500"
                            autoFocus
                            aria-label="Display name"
                          />
                          <button
                            onClick={handleSaveName}
                            disabled={!canSaveName}
                            className="btn-primary text-sm"
                            title={!hasNameChanged ? "No changes to save" : "Save changes"}
                          >
                            Save
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            disabled={updateProfileMutation.isPending}
                            className="btn-tertiary text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                        {/* Inline status messages */}
                        {saveStatus === 'saving' && (
                          <p className="text-sm text-archive">Saving…</p>
                        )}
                        {saveStatus === 'saved' && (
                          <p className="text-sm text-archive">Saved</p>
                        )}
                        {saveStatus === 'error' && saveError && (
                          <p className="text-sm text-stone-700">{saveError}</p>
                        )}
                      </>
                    ) : (
                      <input
                        type="text"
                        value={auth.user.name}
                        disabled
                        className="flex-1 px-3 py-2 border border-lichen rounded-md bg-stone text-ink"
                        aria-label="Display name"
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Timezone subsection */}
            <div className="pt-4 border-t border-lichen">
              <h3 className="text-sm font-medium text-ink mb-3">Preferences</h3>
              
              {/* Timezone */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-ink">Timezone</label>
                  {!isEditingTimezone && (
                    <button
                      onClick={() => {
                        setIsEditingTimezone(true);
                        setTimezoneSaveStatus('idle');
                        setTimezoneError(null);
                      }}
                      className="text-sm text-stone-600 hover:text-stone-800 flex items-center gap-1"
                    >
                      <Edit2 size={14} />
                      Edit
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {isEditingTimezone ? (
                    <>
                      <div className="flex items-center gap-2">
                        <select
                          value={timezone}
                          onChange={(e) => handleTimezoneChange(e.target.value)}
                          className="flex-1 px-3 py-2 border border-lichen rounded-md focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-stone-500"
                          aria-label="Timezone"
                        >
                          {commonTimezones.map((tz) => (
                            <option key={tz.value} value={tz.value}>
                              {tz.label}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={handleCancelTimezoneEdit}
                          disabled={updateTimezoneMutation.isPending}
                          className="px-3 py-2 border border-lichen text-ink text-sm rounded-md hover:bg-stone disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Cancel
                        </button>
                      </div>
                      {timezoneSaveStatus === 'saving' && (
                        <p className="text-sm text-archive">Saving…</p>
                      )}
                      {timezoneSaveStatus === 'saved' && (
                        <p className="text-sm text-archive">Saved</p>
                      )}
                      {timezoneSaveStatus === 'error' && timezoneError && (
                        <p className="text-sm text-stone-700">{timezoneError}</p>
                      )}
                    </>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={commonTimezones.find(tz => tz.value === (auth.user?.timezone || 'America/New_York'))?.label || auth.user?.timezone || 'Eastern Time (ET)'}
                        disabled
                        className="flex-1 px-3 py-2 border border-lichen rounded-md bg-stone text-ink"
                        aria-label="Timezone"
                      />
                      <p className="text-xs text-archive">All times will be displayed in this timezone</p>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Account subsection */}
            <div className="pt-4 border-t border-lichen">
              <h3 className="text-sm font-medium text-ink mb-3">Account</h3>
              
              {/* Email (read-only) */}
              <div className="mb-4">
                <label htmlFor="user-email" className="block text-sm font-medium text-ink mb-1">
                  <Mail size={14} className="inline mr-1" />
                  Email
                </label>
                <input
                  id="user-email"
                  type="email"
                  value={auth.user.email}
                  disabled
                  className="w-full px-3 py-2 border border-lichen rounded-md bg-stone text-ink"
                  aria-label="Email"
                />
                <p className="mt-1 text-xs text-archive">Email cannot be changed</p>
              </div>

              {/* Password change (only if supported) */}
              {supportsPasswordAuth && (
                <div className="mb-4">
                  <button
                    onClick={() => setIsChangePasswordModalOpen(true)}
                    className="text-sm text-stone-600 hover:text-stone-800 border border-lichen px-3 py-2 rounded-md hover:bg-stone"
                  >
                    Change password
                  </button>
                </div>
              )}

              {/* Session info */}
              <div className="text-xs text-archive space-y-1">
                <p>
                  <span className="font-medium">Signed in as:</span> {auth.user.email}
                </p>
                {activeOrg && (
                  <p>
                    <span className="font-medium">Active organization:</span> {activeOrg.name}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* All Organizations - user-scoped, always visible */}
        {auth.memberships.length > 0 && (
          <div className="bg-stone-50/30 rounded border border-stone-200 mt-4">
            <div className="px-6 py-4 border-b border-stone-200">
              <h3 className="text-base font-semibold text-stone-900">
                Your Organizations
                <span className="ml-2 text-sm font-normal text-stone-600">
                  ({auth.memberships.length})
                </span>
              </h3>
              <p className="text-xs text-stone-500 mt-1">Organizations you are a member of</p>
            </div>
            <div className="divide-y divide-stone-200">
              {[...auth.memberships]
                .sort((a, b) => {
                  // Current org first
                  const aIsActive = a.organization_id === auth.activeOrganizationId;
                  const bIsActive = b.organization_id === auth.activeOrganizationId;
                  if (aIsActive && !bIsActive) return -1;
                  if (!aIsActive && bIsActive) return 1;
                  // Then alphabetical by name
                  return a.name.localeCompare(b.name);
                })
                .map((org) => {
                  const isActive = org.organization_id === auth.activeOrganizationId;
                  return (
                    <div
                      key={org.organization_id}
                      onClick={() => navigate(`/organizations/${org.organization_id}`)}
                      className="px-6 py-4 cursor-pointer transition-colors hover:bg-stone-100/50"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Building2 size={20} className="text-stone-500" />
                          <div>
                            <h4 className="font-medium text-stone-900">
                              {org.name}
                            </h4>
                            <p className="text-xs text-stone-400">
                              {org.slug}
                            </p>
                            {isActive && (
                              <p className="text-xs text-stone-500 mt-1">
                                Current organization
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="text-sm text-stone-600">
                          Role: <span className="font-medium text-stone-700">
                            {org.role_label}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>

      {/* Subtle divider between user-scoped and org-scoped sections */}
      {activeOrg && canManageSettings && (
        <div className="mb-8 border-t border-stone-200 pt-8" />
      )}

      {/* ========================================
          SECTION 1b: GUIDE PREFERENCES (User-scoped, private)
          ======================================== */}
      <div className="mb-8">
        <GuidePreferencesPanel />
      </div>

      {/* ========================================
          SECTION 2: ORGANIZATION SETTINGS (Org-scoped)
          Only visible if:
          - User has an active organization AND
          - User has org.manage_settings
          ======================================== */}
      {activeOrg && canManageSettings && (
        <div className="mb-8">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-ink">Organization Settings</h2>
            <p className="text-sm text-archive mt-1">Configure settings for {activeOrg.name}</p>
          </div>

          <div className="bg-parchment rounded-lg shadow border border-lichen">
            <div className="px-6 py-4">
              {/* Organization Identity (always editable, not affected by profile lock) */}
              <div className="mb-4">
                <h3 className="text-base font-semibold text-ink mb-3">Organization Identity</h3>
                
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-ink">Name</label>
                    {!isEditingOrgName && (
                      <button
                        onClick={() => {
                          setIsEditingOrgName(true);
                          setOrgNameSaveStatus('idle');
                          setOrgNameError(null);
                        }}
                        className="text-sm text-stone-500 hover:text-stone-700 flex items-center gap-1"
                      >
                        <Edit2 size={14} />
                        Edit
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    {isEditingOrgName ? (
                      <>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={orgName}
                            onChange={(e) => setOrgName(e.target.value)}
                            onKeyDown={handleOrgNameKeyDown}
                            onFocus={(e) => e.target.select()}
                            placeholder="Enter organization name"
                            className="flex-1 px-3 py-2 border border-lichen rounded-md focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-stone-500"
                            autoFocus
                            aria-label="Organization name"
                          />
                          <button
                            onClick={handleSaveOrgName}
                            disabled={!canSaveOrgName}
                            className="btn-primary text-sm"
                            title={!hasOrgNameChanged ? "No changes to save" : !isOrgNameValid ? "Name must be 1-200 characters" : "Save changes"}
                          >
                            Save
                          </button>
                          <button
                            onClick={handleCancelOrgNameEdit}
                            disabled={updateOrgNameMutation.isPending}
                            className="btn-tertiary text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                        {/* Inline status messages */}
                        {orgNameSaveStatus === 'saving' && (
                          <p className="text-sm text-archive">Saving…</p>
                        )}
                        {orgNameSaveStatus === 'saved' && (
                          <p className="text-sm text-archive">Saved</p>
                        )}
                        {orgNameSaveStatus === 'error' && orgNameError && (
                          <p className="text-sm text-stone-700">{orgNameError}</p>
                        )}
                        {!isOrgNameValid && orgName.trim().length > 0 && (
                          <p className="text-xs text-archive">Name must be 1-200 characters</p>
                        )}
                      </>
                    ) : (
                      <input
                        type="text"
                        value={activeOrg.name}
                        disabled
                        className="flex-1 px-3 py-2 border border-lichen rounded-md bg-stone text-ink"
                        aria-label="Organization name"
                      />
                    )}
                  </div>
                </div>

                <div className="text-sm text-archive mt-3">
                  <Shield size={14} className="inline mr-1 text-archive" />
                  Your role: <span className="font-medium text-stone-700">
                    {activeOrg.role_label}
                  </span>
                </div>

                {/* Organization Timezone */}
                <div className="mt-4 pt-4 border-t border-lichen">
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-ink">Timezone</label>
                    {!isEditingOrgTimezone && (
                      <button
                        onClick={() => {
                          setIsEditingOrgTimezone(true);
                          setOrgTimezoneSaveStatus('idle');
                          setOrgTimezoneError(null);
                        }}
                        className="text-sm text-stone-500 hover:text-stone-700 flex items-center gap-1"
                      >
                        <Edit2 size={14} />
                        Edit
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    {isEditingOrgTimezone ? (
                      <>
                        <div className="flex items-center gap-2">
                          <select
                            value={orgTimezone}
                            onChange={(e) => handleOrgTimezoneChange(e.target.value)}
                            className="flex-1 px-3 py-2 border border-lichen rounded-md focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-stone-500"
                          >
                            {orgTimezoneOptions.map((tz) => (
                              <option key={tz.value} value={tz.value}>
                                {tz.label}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={handleCancelOrgTimezoneEdit}
                            disabled={updateOrgTimezoneMutation.isPending}
                            className="px-3 py-2 border border-lichen text-ink text-sm rounded-md hover:bg-stone disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Cancel
                          </button>
                        </div>
                        {orgTimezoneSaveStatus === 'saving' && (
                          <p className="text-sm text-archive">Saving…</p>
                        )}
                        {orgTimezoneSaveStatus === 'saved' && (
                          <p className="text-sm text-archive">Saved</p>
                        )}
                        {orgTimezoneSaveStatus === 'error' && orgTimezoneError && (
                          <p className="text-sm text-stone-700">{orgTimezoneError}</p>
                        )}
                      </>
                    ) : (
                      <>
                        <input
                          type="text"
                          value={orgTimezoneOptions.find(tz => tz.value === (activeOrg?.timezone || 'UTC'))?.label || activeOrg?.timezone || 'UTC'}
                          disabled
                          className="flex-1 px-3 py-2 border border-lichen rounded-md bg-stone text-ink"
                          aria-label="Organization timezone"
                        />
                        <p className="text-xs text-archive">All scheduled runs and timestamps will use this timezone</p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Storage */}
              <div className="mt-4 pt-4 border-t border-lichen">
                <div className="flex items-center gap-2 mb-3">
                  <HardDrive size={16} className="text-forest" />
                  <h3 className="text-base font-semibold text-ink">Storage</h3>
                </div>

                {storageLoading && (
                  <div className="flex items-center gap-2 text-sm text-archive">
                    <div className="w-4 h-4 border-2 border-forest/30 border-t-forest rounded-full animate-spin" />
                    <MadronaLoader variant="dots" />
                  </div>
                )}

                {storageError && (
                  <p className="text-sm text-semantic-error">Unable to load storage information.</p>
                )}

                {storageStats?.usage && (() => {
                  const usedGb = storageStats.usage.used_gb;
                  const limitGb = storageStats.usage.limit_gb;
                  const percent = storageStats.usage.usage_percent;
                  const isWarning = percent >= 75 && percent < 90;
                  const isCritical = percent >= 90;
                  const mediaBytes = storageStats.usage.media_bytes ?? storageStats.usage.used_bytes;
                  const dbBytes = storageStats.usage.db_bytes ?? 0;
                  const searchBytes = storageStats.usage.search_bytes ?? 0;
                  const hasBreakdown = dbBytes > 0 || searchBytes > 0;

                  const formatBytesCompact = (bytes: number): string => {
                    if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
                    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
                    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
                    return `${(bytes / 1024).toFixed(0)} KB`;
                  };

                  return (
                    <div className="space-y-3">
                      {/* Gauge */}
                      <div>
                        <div className="flex items-baseline justify-between mb-1.5">
                          <span className="text-lg font-semibold text-ink">
                            {formatStorageSize(usedGb)}
                          </span>
                          <span className="text-sm text-archive">
                            of {formatStorageSize(limitGb)}
                          </span>
                        </div>
                        <div className="w-full h-2 bg-stone rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              isCritical ? 'bg-semantic-error' : isWarning ? 'bg-semantic-warning' : 'bg-forest'
                            }`}
                            style={{ width: `${Math.max(Math.min(percent, 100), 0.5)}%` }}
                          />
                        </div>
                      </div>

                      {/* Breakdown by type */}
                      {hasBreakdown && (
                        <div className="grid grid-cols-3 gap-3 text-sm">
                          <div>
                            <span className="text-archive">Media</span>
                            <p className="font-medium text-ink">{formatBytesCompact(mediaBytes)}</p>
                          </div>
                          <div>
                            <span className="text-archive">Database</span>
                            <p className="font-medium text-ink">{formatBytesCompact(dbBytes)}</p>
                          </div>
                          <div>
                            <span className="text-archive">Search</span>
                            <p className="font-medium text-ink">{formatBytesCompact(searchBytes)}</p>
                          </div>
                        </div>
                      )}

                      {/* Warning — only when it matters */}
                      {isCritical && (
                        <div className="flex items-start gap-2 p-3 bg-semantic-error/10 border border-semantic-error/20 rounded-md">
                          <AlertCircle size={16} className="text-semantic-error mt-0.5 shrink-0" />
                          <p className="text-sm text-semantic-error">
                            Storage is nearly full. Additional capacity is available at $25/TB/month — contact your Madrona representative to expand your plan.
                          </p>
                        </div>
                      )}
                      {isWarning && (
                        <div className="flex items-start gap-2 p-3 bg-semantic-warning/10 border border-semantic-warning/20 rounded-md">
                          <AlertCircle size={16} className="text-semantic-warning mt-0.5 shrink-0" />
                          <p className="text-sm text-semantic-warning">
                            You're approaching your included storage limit. Additional capacity is available at $25/TB/month if needed.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Change Password Modal */}
      <ChangePasswordModal
        isOpen={isChangePasswordModalOpen}
        onClose={() => setIsChangePasswordModalOpen(false)}
      />

    </div>
  );
};