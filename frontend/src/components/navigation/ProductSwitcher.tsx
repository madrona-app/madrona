import { useState, useRef, useEffect, useId } from 'react';
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

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
        triggerRef.current?.focus();
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  // Listbox keyboard model: focus starts on the selected option; Up/Down/Home/End
  // move between enabled options; Enter/Space activate (native button); Tab closes.
  const enabledOptions = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])') ?? []);

  useEffect(() => {
    if (!isOpen) return;
    const opts = enabledOptions();
    const selected = opts.find((o) => o.getAttribute('aria-selected') === 'true') ?? opts[0];
    selected?.focus();
  }, [isOpen]);

  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const opts = enabledOptions();
    if (opts.length === 0) return;
    const idx = opts.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % opts.length;
    else if (e.key === 'ArrowUp') next = idx <= 0 ? opts.length - 1 : idx - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = opts.length - 1;
    else if (e.key === 'Tab') setIsOpen(false);
    if (next !== null) {
      e.preventDefault();
      opts[next].focus();
    }
  };

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
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`product-switcher-trigger ${isOpen ? 'product-switcher-trigger--open' : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={isOpen ? listId : undefined}
        aria-label={`Switch application. Current application: ${displayName}`}
      >
        {activeProduct && <AppTile appKey={activeProduct.id} className="w-6 h-6" iconSize={14} />}
        <span className="product-switcher-product">{displayName}</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`product-switcher-chevron ${isOpen ? 'product-switcher-chevron--open' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="product-switcher-dropdown">
          {/* Dropdown header */}
          <div className="product-switcher-header" aria-hidden="true">
            <span className="product-switcher-header-label">APPLICATIONS</span>
          </div>

          {/* Product list */}
          {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus -- listbox focus is roving on its options (each option is a button) */}
          <div
            ref={listRef}
            id={listId}
            className="product-switcher-list"
            role="listbox"
            aria-label="Select application"
            onKeyDown={handleListKeyDown}
          >
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
                    <span className="product-switcher-upgrade">
                      Upgrade<span className="sr-only"> required, not available</span>
                    </span>
                  </div>
                );
              }

              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => handleProductClick(path, product.id)}
                  className={`product-switcher-option ${isActive ? 'product-switcher-option--active' : ''}`}
                  role="option"
                  aria-selected={isActive}
                  tabIndex={-1}
                >
                  <AppTile appKey={product.id} className="w-6 h-6" iconSize={14} />
                  <div className="product-switcher-option-content">
                    <span className="product-switcher-option-label">{product.label}</span>
                  </div>
                  {isActive && <Check size={16} className="product-switcher-option-check" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
