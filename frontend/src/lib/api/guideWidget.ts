import { apiFetch } from '../apiClient';

export interface WidgetSettings {
  enabled: boolean;
  welcome_message: string | null;
  tier: string | null;
  max_widget_queries: number | null;
  widget_queries_this_month: number;
}

export function getWidgetSettings(): Promise<WidgetSettings> {
  return apiFetch<WidgetSettings>('/guide/widget/settings');
}

export function updateWidgetSettings(body: {
  enabled: boolean;
  welcome_message?: string | null;
}): Promise<WidgetSettings> {
  return apiFetch<WidgetSettings>('/guide/widget/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
