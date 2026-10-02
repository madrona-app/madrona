import React, { useState, useRef, useEffect } from 'react';

interface TooltipProps {
  content: string | React.ReactNode;
  children: React.ReactElement;
  /**
   * When true, the tooltip is NOT shown (element is enabled, no explanation needed).
   * When false, the tooltip IS shown (element is disabled, explain why).
   * Use for permission-gated buttons.
   */
  disabled?: boolean;
  /**
   * When true, always show tooltip on hover regardless of disabled state.
   * Use for informational tooltips that explain what something does.
   */
  alwaysShow?: boolean;
}

/**
 * Tooltip component that displays explanatory text on hover.
 *
 * Two modes:
 * 1. Permission mode (default): Only shows tooltip when disabled=false (element is disabled)
 * 2. Informational mode (alwaysShow=true): Always shows tooltip on hover
 *
 * @example Permission tooltip
 * <Tooltip content="Requires runs.execute permission" disabled={hasPermission('runs.execute')}>
 *   <button disabled={!hasPermission('runs.execute')}>Execute Run</button>
 * </Tooltip>
 *
 * @example Informational tooltip
 * <Tooltip content="Processes only changed records since last sync" alwaysShow>
 *   <button>Run Incremental Sync</button>
 * </Tooltip>
 */
export function Tooltip({ content, children, disabled = false, alwaysShow = false }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const reactId = React.useId();
  
  useEffect(() => {
    if (isVisible && triggerRef.current && tooltipRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      
      // Position tooltip above the trigger element, centered
      const left = triggerRect.left + (triggerRect.width / 2) - (tooltipRect.width / 2);
      const top = triggerRect.top - tooltipRect.height - 8;
      
      // Ensure tooltip stays within viewport
      const finalLeft = Math.max(8, Math.min(left, window.innerWidth - tooltipRect.width - 8));
      const finalTop = Math.max(8, top);
      
      setPosition({ top: finalTop, left: finalLeft });
    }
  }, [isVisible]);
  
  // Show tooltip if alwaysShow is true, or if disabled is false (permission not granted)
  const shouldShowTooltip = alwaysShow || !disabled;
  if (!shouldShowTooltip) {
    return children;
  }
  
  const tooltipId = `tooltip-${reactId}`;

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        onFocus={() => setIsVisible(true)}
        onBlur={() => setIsVisible(false)}
        style={{ display: 'inline-block' }}
        aria-describedby={isVisible ? tooltipId : undefined}
      >
        {children}
      </div>
      
      {isVisible && (
        <div
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          style={{
            position: 'fixed',
            top: `${position.top}px`,
            left: `${position.left}px`,
            backgroundColor: 'rgb(var(--color-accessible-gray))',
            color: 'rgb(var(--color-parchment-warm))',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            lineHeight: '1.4',
            maxWidth: '240px',
            zIndex: 9999,
            pointerEvents: 'none',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              bottom: '-4px',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '4px solid transparent',
              borderRight: '4px solid transparent',
              borderTop: '4px solid #1f2937',
            }}
          />
          {content}
        </div>
      )}
    </>
  );
}
