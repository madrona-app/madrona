import React from 'react';
import { ChevronDown } from 'lucide-react';
import { useSidebar } from '../../contexts/SidebarContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuth } from '../../hooks/useAuth';
import { ProductNavItem } from './ProductNavItem';
import type { Product } from '../../lib/navigationConfig';

interface ProductNavProps {
  product: Product;
  orgId: string | null | undefined;
}

export function ProductNav({ product, orgId }: ProductNavProps) {
  const { isCollapsed, isSectionExpanded, toggleSection } = useSidebar();
  const { hasPermission } = usePermissions();
  const { hasAppAccess } = useAuth();

  const isExpanded = isSectionExpanded(product.id);

  // Check if org has access to this app (if appKey is specified)
  const hasAccess = product.appKey ? hasAppAccess(product.appKey) : true;

  // Filter items by permissions
  const visibleItems = product.items.filter(item => {
    if (item.requiresApp && !hasAppAccess(item.requiresApp)) return false;
    if (!item.requiresPermission) return true;
    return hasPermission(item.requiresPermission);
  });

  // Don't render if:
  // 1. No access to this app
  // 2. No visible items and no badge (coming soon products still show)
  if (!hasAccess || (visibleItems.length === 0 && !product.badge)) {
    return null;
  }

  const Icon = product.icon as React.ComponentType<{ size?: number; className?: string }>;

  const handleHeaderClick = () => {
    // Don't toggle if product has no items (coming soon)
    if (visibleItems.length > 0) {
      toggleSection(product.id);
    }
  };

  // When collapsed, show only nav items (no confusing product headers)
  if (isCollapsed) {
    // Don't show coming-soon products when collapsed
    if (visibleItems.length === 0) {
      return null;
    }

    return (
      <div className="sidebar-product-collapsed">
        {/* Subtle product label - just a tiny indicator */}
        <div className="sidebar-product-indicator" title={product.label}>
          <span className="sidebar-product-indicator-dot" />
        </div>
        <nav aria-label={`${product.label} navigation`}>
          {visibleItems.map(item => (
            <ProductNavItem key={item.id} item={item} orgId={orgId} siblings={visibleItems} />
          ))}
        </nav>
      </div>
    );
  }

  // Expanded view - show full product headers
  return (
    <div className="sidebar-product">
      <button
        onClick={handleHeaderClick}
        className="sidebar-product-header w-full"
        aria-expanded={isExpanded}
        aria-controls={`product-nav-${product.id}`}
        disabled={visibleItems.length === 0}
      >
        <div className="flex items-center gap-2">
          <Icon size={16} className="sidebar-nav-item-icon" />
          <span className="sidebar-product-label">{product.label}</span>
          {product.badge === 'coming-soon' && (
            <span className="sidebar-badge-coming-soon">Soon</span>
          )}
        </div>
        {visibleItems.length > 0 && (
          <ChevronDown
            size={14}
            className={`sidebar-product-chevron ${isExpanded ? 'sidebar-product-chevron--expanded' : ''}`}
          />
        )}
      </button>

      {/* Nav items */}
      {isExpanded && visibleItems.length > 0 && (
        <nav
          id={`product-nav-${product.id}`}
          aria-label={`${product.label} navigation`}
        >
          {visibleItems.map(item => (
            <ProductNavItem key={item.id} item={item} orgId={orgId} siblings={visibleItems} />
          ))}
        </nav>
      )}
    </div>
  );
}
