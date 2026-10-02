import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronDown, Check } from 'lucide-react';
import { useActiveProduct, getProductLandingPath } from '../../hooks/useActiveProduct';
import { useAuth } from '../../hooks/useAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { products } from '../../lib/navigationConfig';
import { AppTile } from '../AppTile';

/**
 * Product descriptors removed — labels are self-explanatory
 * and descriptions made the dropdown too tall.
 */

/**
 * ProductSwitcher displays "{Product} ▾" in the header
 * and provides a dropdown to switch between applications.
 *
 * Switching navigates immediately and resets application context.
 */
export function ProductSwitcher() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { activeOrganizationId, hasAppAccess } = useAuth();
  const { hasPermission } = usePermissions();
  const effectiveOrgId = orgId || activeOrganizationId;
  const { activeProduct, activeProductId } = useActiveProduct();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  const handleProductClick = (path: string, productId: string) => {
    // Close dropdown immediately
    setIsOpen(false);

    // If clicking the already-active product, do nothing else
    if (productId === activeProductId) {
      return;
    }

    // App switch is a context shift — use the View Transitions API for an
    // intentfully-paced crossfade (see index.css for animation rules).
    navigate(path, { viewTransition: true });
  };

  // Get all products for display (including unlicensed ones shown as disabled)
  // Sort alphabetically by label for consistent ordering
  const sortedProducts = [...products].sort((a, b) => a.label.localeCompare(b.label));

  // The Guide app is now admin-only config (Corpus + Widget); regular users get
  // the assistant via the ambient dock, not a dedicated app. Hide Guide from
  // non-admins — UNLESS it's their only accessible app (a standalone Guide org),
  // so we never strand a user with an empty switcher.
  const canManageGuide = hasPermission('org.manage_settings');
  const allDisplayProducts = sortedProducts.filter((product) => {
    if (product.appKey !== 'guide' || canManageGuide) return true;
    const hasAnotherApp = sortedProducts.some(
      (p) => p.id !== product.id && (!p.appKey || hasAppAccess(p.appKey)),
    );
    return !hasAnotherApp;
  });

  const displayName = activeProduct?.label || 'Madrona';

  return (
    <div className="product-switcher" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`product-switcher-trigger ${isOpen ? 'product-switcher-trigger--open' : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`Current application: ${displayName}. Click to switch applications.`}
      >
        {activeProduct && <AppTile appKey={activeProduct.id} className="w-6 h-6" iconSize={14} />}
        <span className="product-switcher-product">{displayName}</span>
        <ChevronDown
          size={14}
          className={`product-switcher-chevron ${isOpen ? 'product-switcher-chevron--open' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="product-switcher-dropdown" role="listbox" aria-label="Select application">
          {/* Dropdown header */}
          <div className="product-switcher-header">
            <span className="product-switcher-header-label">APPLICATIONS</span>
          </div>

          {/* Product list */}
          <div className="product-switcher-list">
            {allDisplayProducts.map(product => {
              const isActive = product.id === activeProductId;
              const hasAccess = !product.appKey || hasAppAccess(product.appKey);
              const path = effectiveOrgId
                ? getProductLandingPath(product.id, effectiveOrgId)
                : '/';

              if (!hasAccess) {
                // Unlicensed product - render as non-interactive
                return (
                  <div
                    key={product.id}
                    className="product-switcher-option product-switcher-option--disabled"
                    role="option"
                    aria-selected={false}
                    aria-disabled={true}
                  >
                    <AppTile appKey={product.id} className="w-6 h-6" iconSize={14} />
                    <div className="product-switcher-option-content">
                      <span className="product-switcher-option-label">{product.label}</span>
                    </div>
                    <span className="product-switcher-upgrade">Upgrade</span>
                  </div>
                );
              }

              return (
                <button
                  key={product.id}
                  onClick={() => handleProductClick(path, product.id)}
                  className={`product-switcher-option ${isActive ? 'product-switcher-option--active' : ''}`}
                  role="option"
                  aria-selected={isActive}
                >
                  <AppTile appKey={product.id} className="w-6 h-6" iconSize={14} />
                  <div className="product-switcher-option-content">
                    <span className="product-switcher-option-label">{product.label}</span>
                  </div>
                  {isActive && <Check size={16} className="product-switcher-option-check" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
