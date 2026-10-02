import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { RefreshCw, AlertCircle, CheckCircle, Database, Search, MapPin, Globe } from 'lucide-react';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { reindexCollections, type ReindexResult } from '../../lib/api';
import { useOrganization } from '../../contexts/useOrganization';
import useGeo from '../../hooks/useGeo';

export default function CollectionsGeneralSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;
  const queryClient = useQueryClient();

  const [lastResult, setLastResult] = useState<ReindexResult | null>(null);

  // Headquarters coordinates state
  const { useHeadquarters, updateHeadquarters, geocode } = useGeo();
  const headquartersQuery = useHeadquarters();
  const [hqLatitude, setHqLatitude] = useState<string>('');
  const [hqLongitude, setHqLongitude] = useState<string>('');
  const [hqAddress, setHqAddress] = useState<string>('');
  const [hqSaveStatus, setHqSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [isGeocoding, setIsGeocoding] = useState(false);

  // Initialize form values when data loads
  useEffect(() => {
    if (headquartersQuery.data) {
      setHqLatitude(headquartersQuery.data.latitude?.toString() || '');
      setHqLongitude(headquartersQuery.data.longitude?.toString() || '');
    }
  }, [headquartersQuery.data]);

  const reindexMutation = useMutation({
    mutationFn: () => {
      if (!organizationId) throw new Error('No organization selected');
      return reindexCollections(organizationId);
    },
    onSuccess: (result) => {
      setLastResult(result);
    },
  });

  const handleReindex = () => {
    setLastResult(null);
    reindexMutation.mutate();
  };

  const handleGeocodeAddress = async () => {
    if (!hqAddress.trim()) return;
    setIsGeocoding(true);
    try {
      const result = await geocode.mutateAsync({ address: hqAddress });
      if (result.success && result.point) {
        setHqLatitude(result.point.latitude.toString());
        setHqLongitude(result.point.longitude.toString());
      }
    } finally {
      setIsGeocoding(false);
    }
  };

  const handleSaveHeadquarters = async () => {
    setHqSaveStatus('saving');
    try {
      const lat = hqLatitude ? parseFloat(hqLatitude) : null;
      const lng = hqLongitude ? parseFloat(hqLongitude) : null;
      await updateHeadquarters.mutateAsync({ latitude: lat, longitude: lng });
      queryClient.invalidateQueries({ queryKey: ['geo', 'headquarters'] });
      queryClient.invalidateQueries({ queryKey: ['geo', 'loan-network'] });
      setHqSaveStatus('saved');
      setTimeout(() => setHqSaveStatus('idle'), 3000);
    } catch {
      setHqSaveStatus('error');
    }
  };

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-ink">Collections Settings</h1>
        <p className="text-sm text-accessible-gray mt-1">Manage general Collections configuration</p>
      </div>

      {/* Search Index Management */}
      <section className="bg-parchment rounded-lg border border-lichen shadow-sm">
        <div className="px-6 py-4 border-b border-lichen">
          <div className="flex items-center gap-2">
            <Search size={18} className="text-forest" />
            <h2 className="text-lg font-semibold text-ink">Search Index</h2>
          </div>
          <p className="text-sm text-accessible-gray mt-1">
            Manage the OpenSearch index for collection objects
          </p>
        </div>

        <div className="px-6 py-5">
          {/* Reindex Section */}
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Database size={16} className="text-archive" />
                <h3 className="font-medium text-ink">Reindex Collection Objects</h3>
              </div>
              <p className="text-sm text-accessible-gray mt-1 ml-6">
                Rebuild the search index from the database. This ensures all collection objects
                are searchable and their data is up to date. Use this if search results seem
                incomplete or out of sync.
              </p>
            </div>
            <button
              onClick={handleReindex}
              disabled={reindexMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-forest text-parchment rounded-md hover:bg-forest/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw size={16} className={reindexMutation.isPending ? 'animate-spin' : ''} />
              {reindexMutation.isPending ? 'Reindexing...' : 'Reindex Now'}
            </button>
          </div>

          {/* Status/Results */}
          {reindexMutation.isPending && (
            <div className="mt-4 ml-6 flex items-center gap-2 text-sm text-accessible-gray">
              <MadronaLoader variant="dots" />
              <span>Rebuilding search index... This may take a moment for large collections.</span>
            </div>
          )}

          {reindexMutation.isError && (
            <div className="mt-4 ml-6 flex items-start gap-2 p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-md">
              <AlertCircle size={16} className="text-semantic-error mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-semantic-error">Reindex Failed</p>
                <p className="text-sm text-semantic-error mt-0.5">
                  {reindexMutation.error instanceof Error
                    ? reindexMutation.error.message
                    : 'An unexpected error occurred'}
                </p>
              </div>
            </div>
          )}

          {lastResult && reindexMutation.isSuccess && (
            <div className="mt-4 ml-6 flex items-start gap-2 p-3 bg-semantic-success/10 border border-semantic-success/30 rounded-md">
              <CheckCircle size={16} className="text-semantic-success mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-semantic-success">Reindex Complete</p>
                <p className="text-sm text-semantic-success mt-0.5">
                  Successfully indexed {lastResult.indexed} of {lastResult.total} objects
                  {lastResult.errors > 0 && (
                    <span className="text-semantic-warning"> ({lastResult.errors} errors)</span>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Info note */}
          <div className="mt-6 ml-6 p-3 bg-stone/30 border border-lichen rounded-md">
            <p className="text-xs text-accessible-gray">
              <strong>Note:</strong> The search index is automatically updated when objects are
              created, modified, or deleted. Manual reindexing is only needed if you suspect
              the index is out of sync with the database.
            </p>
          </div>
        </div>
      </section>

      {/* Organization Headquarters Location */}
      <section className="bg-parchment rounded-lg border border-lichen shadow-sm mt-6">
        <div className="px-6 py-4 border-b border-lichen">
          <div className="flex items-center gap-2">
            <Globe size={18} className="text-forest" />
            <h2 className="text-lg font-semibold text-ink">Organization Location</h2>
          </div>
          <p className="text-sm text-accessible-gray mt-1">
            Set your organization's headquarters coordinates for GIS visualizations
          </p>
        </div>

        <div className="px-6 py-5">
          {/* Headquarters Coordinates */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <MapPin size={16} className="text-archive" />
              <h3 className="font-medium text-ink">Headquarters Coordinates</h3>
            </div>
            <p className="text-sm text-accessible-gray ml-6">
              These coordinates are used as the center point for the Loan Network Map
              visualization and other GIS features.
            </p>

            {/* Geocoding from address */}
            <div className="ml-6">
              <label className="block text-sm font-medium text-ink mb-1">
                Find from address
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={hqAddress}
                  onChange={(e) => setHqAddress(e.target.value)}
                  placeholder="Enter your organization's address..."
                  className="flex-1 px-3 py-2 border border-lichen rounded-md text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                />
                <button
                  onClick={handleGeocodeAddress}
                  disabled={isGeocoding || !hqAddress.trim()}
                  className="px-4 py-2 bg-stone text-ink rounded-md hover:bg-stone/80 disabled:opacity-50 disabled:cursor-not-allowed text-sm transition-colors"
                >
                  {isGeocoding ? 'Finding...' : 'Find'}
                </button>
              </div>
            </div>

            {/* Coordinate fields */}
            <div className="ml-6 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  Latitude
                </label>
                <input
                  type="number"
                  step="any"
                  value={hqLatitude}
                  onChange={(e) => setHqLatitude(e.target.value)}
                  placeholder="e.g., 40.7128"
                  className="w-full px-3 py-2 border border-lichen rounded-md text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  Longitude
                </label>
                <input
                  type="number"
                  step="any"
                  value={hqLongitude}
                  onChange={(e) => setHqLongitude(e.target.value)}
                  placeholder="e.g., -74.0060"
                  className="w-full px-3 py-2 border border-lichen rounded-md text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                />
              </div>
            </div>

            {/* Save button and status */}
            <div className="ml-6 flex items-center gap-3">
              <button
                onClick={handleSaveHeadquarters}
                disabled={hqSaveStatus === 'saving'}
                className="px-4 py-2 bg-forest text-parchment rounded-md hover:bg-forest/90 disabled:opacity-50 disabled:cursor-not-allowed text-sm transition-colors"
              >
                {hqSaveStatus === 'saving' ? 'Saving...' : 'Save Coordinates'}
              </button>
              {hqSaveStatus === 'saved' && (
                <span className="flex items-center gap-1 text-sm text-semantic-success">
                  <CheckCircle size={14} />
                  Saved
                </span>
              )}
              {hqSaveStatus === 'error' && (
                <span className="flex items-center gap-1 text-sm text-semantic-error">
                  <AlertCircle size={14} />
                  Failed to save
                </span>
              )}
            </div>

            {/* Clear button */}
            {(hqLatitude || hqLongitude) && (
              <div className="ml-6">
                <button
                  onClick={() => {
                    setHqLatitude('');
                    setHqLongitude('');
                  }}
                  className="text-sm text-archive hover:text-ink transition-colors"
                >
                  Clear coordinates
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
