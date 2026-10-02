import { APIRequestContext } from '@playwright/test';

export interface CreateObjectResponse {
  object_id: string;
  object_number: string;
}

export interface CollectionObjectPayload {
  object_number: string;
  title?: string;
  object_type?: string;
  description?: string;
}

/**
 * Generate a unique test object number with timestamp and random suffix.
 * Format: E2E-TEST-{timestamp}-{random}
 */
export function generateTestObjectNumber(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `E2E-TEST-${timestamp}-${random}`;
}

/**
 * API helpers for managing test data.
 */
export class ApiHelpers {
  private baseUrl: string;
  private csrfToken: string | null = null;

  constructor(
    private request: APIRequestContext,
    private orgId: string
  ) {
    // Empty by default, so request paths stay relative and resolve against
    // the configured baseURL — the same origin, proxy and session cookie the
    // browser uses. It defaulted to http://localhost:8000, which only matched
    // because CI happens to run the backend there and cookies ignore ports.
    // Against any other origin these calls carried no session and went to
    // whatever was listening on 8000: on a machine running its own Madrona,
    // that is the developer's real backend.
    this.baseUrl = process.env.PLAYWRIGHT_API_URL || '';
  }

  /**
   * Lazily fetch a CSRF token. The backend enforces a double-submit check on
   * all state-changing /api/* requests (X-CSRF-Token header must match the
   * csrf_token cookie); mint-session only sets the refresh cookie, so without
   * this every POST/PUT/DELETE here 403s with "CSRF token missing" — the
   * reason the journey suite never passed. GET /api/auth/csrf both returns the
   * token and sets the cookie on this shared request context's jar, so the
   * header we add below matches.
   */
  private async ensureCsrf(): Promise<string> {
    if (this.csrfToken) return this.csrfToken;
    const res = await this.request.get(`${this.baseUrl}/api/auth/csrf`);
    if (!res.ok()) {
      throw new Error(`Failed to fetch CSRF token: ${res.status()}`);
    }
    this.csrfToken = ((await res.json()) as { csrf_token: string }).csrf_token;
    return this.csrfToken;
  }

  /** Headers for a state-changing request: caller's headers + the CSRF token. */
  private async mutatingHeaders(
    base: Record<string, string> = {}
  ): Promise<Record<string, string>> {
    return { ...base, 'X-CSRF-Token': await this.ensureCsrf() };
  }

  /**
   * Create a collection object via API.
   */
  async createCollectionObject(
    data: CollectionObjectPayload
  ): Promise<CreateObjectResponse> {
    const response = await this.request.post(
      `${this.baseUrl}/api/organizations/${this.orgId}/collections/objects`,
      {
        data,
        headers: await this.mutatingHeaders({ 'Content-Type': 'application/json' }),
      }
    );

    if (!response.ok()) {
      const body = await response.text();
      throw new Error(
        `Failed to create collection object: ${response.status()} - ${body}`
      );
    }

    return await response.json();
  }

  /**
   * Delete a collection object via API.
   */
  async deleteCollectionObject(objectId: string): Promise<void> {
    const response = await this.request.delete(
      `${this.baseUrl}/api/organizations/${this.orgId}/collections/objects/${objectId}`,
      { headers: await this.mutatingHeaders() }
    );

    if (!response.ok() && response.status() !== 404) {
      const body = await response.text();
      throw new Error(
        `Failed to delete collection object: ${response.status()} - ${body}`
      );
    }
  }

  /**
   * Get a collection object by ID.
   */
  async getCollectionObject(objectId: string): Promise<unknown> {
    const response = await this.request.get(
      `${this.baseUrl}/api/organizations/${this.orgId}/collections/objects/${objectId}`
    );

    if (!response.ok()) {
      if (response.status() === 404) {
        return null;
      }
      const body = await response.text();
      throw new Error(
        `Failed to get collection object: ${response.status()} - ${body}`
      );
    }

    return await response.json();
  }

  /**
   * Search for collection objects.
   */
  async searchCollectionObjects(query: string): Promise<unknown[]> {
    const response = await this.request.get(
      `${this.baseUrl}/api/organizations/${this.orgId}/collections/objects`,
      {
        params: { q: query },
      }
    );

    if (!response.ok()) {
      const body = await response.text();
      throw new Error(
        `Failed to search collection objects: ${response.status()} - ${body}`
      );
    }

    const data = await response.json();
    return data.items || data.objects || data;
  }

  /**
   * Cleanup all test data with a given prefix.
   */
  async cleanupTestData(prefix = 'E2E-TEST-'): Promise<number> {
    let deleted = 0;

    try {
      const objects = await this.searchCollectionObjects(prefix);

      for (const obj of objects) {
        const objectId = (obj as { object_id?: string }).object_id;
        const objectNumber = (obj as { object_number?: string }).object_number;

        if (objectId && objectNumber?.startsWith(prefix)) {
          try {
            await this.deleteCollectionObject(objectId);
            deleted++;
          } catch (error) {
            console.warn(`Failed to delete object ${objectId}:`, error);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to cleanup test data:', error);
    }

    return deleted;
  }

  /**
   * Wait for an object to be indexed and searchable.
   */
  async waitForObjectIndexed(
    objectNumber: string,
    maxWaitMs = 5000
  ): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const objects = await this.searchCollectionObjects(objectNumber);
      const found = objects.some(
        (obj) =>
          (obj as { object_number?: string }).object_number === objectNumber
      );

      if (found) {
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return false;
  }

  /**
   * Create a deaccession linked to an object via API.
   */
  async createDeaccession(data: {
    object_id: string;
    reason?: string;
    reason_detail?: string;
  }): Promise<{ deaccession_id: string; deaccession_number: string }> {
    const response = await this.request.post(
      `${this.baseUrl}/api/organizations/${this.orgId}/collections/deaccessions`,
      {
        data: {
          // Must be one of the check_deaccession_reason values (procedures.py);
          // 'disposal' is not valid (that's an exit_reason). 'other' is the
          // neutral choice for a fixture.
          reason: 'other',
          reason_detail: 'E2E test deaccession',
          ...data,
        },
        headers: await this.mutatingHeaders({ 'Content-Type': 'application/json' }),
      }
    );

    if (!response.ok()) {
      const body = await response.text();
      throw new Error(`Failed to create deaccession: ${response.status()} - ${body}`);
    }

    return await response.json();
  }

  /**
   * Complete a deaccession via the dedicated /complete endpoint.
   */
  async completeDeaccession(deaccessionId: string): Promise<void> {
    const response = await this.request.post(
      `${this.baseUrl}/api/organizations/${this.orgId}/collections/deaccessions/${deaccessionId}/complete`,
      { headers: await this.mutatingHeaders({ 'Content-Type': 'application/json' }) }
    );

    if (!response.ok()) {
      const body = await response.text();
      throw new Error(`Failed to complete deaccession: ${response.status()} - ${body}`);
    }
  }

  /**
   * Update a deaccession via PUT.
   */
  async updateDeaccession(deaccessionId: string, data: Record<string, unknown>): Promise<void> {
    const response = await this.request.put(
      `${this.baseUrl}/api/organizations/${this.orgId}/collections/deaccessions/${deaccessionId}`,
      {
        data,
        headers: await this.mutatingHeaders({ 'Content-Type': 'application/json' }),
      }
    );

    if (!response.ok()) {
      const body = await response.text();
      throw new Error(`Failed to update deaccession: ${response.status()} - ${body}`);
    }
  }

  /**
   * Delete a deaccession via API.
   */
  async deleteDeaccession(deaccessionId: string): Promise<void> {
    const response = await this.request.delete(
      `${this.baseUrl}/api/organizations/${this.orgId}/collections/deaccessions/${deaccessionId}`,
      { headers: await this.mutatingHeaders() }
    );

    if (!response.ok() && response.status() !== 404) {
      const body = await response.text();
      throw new Error(`Failed to delete deaccession: ${response.status()} - ${body}`);
    }
  }

  /**
   * Create a shipment via API. Returns its id.
   */
  async createShipment(data: Record<string, unknown>): Promise<string> {
    const response = await this.request.post(
      `${this.baseUrl}/api/organizations/${this.orgId}/collections/shipments`,
      {
        data,
        headers: await this.mutatingHeaders({ 'Content-Type': 'application/json' }),
      }
    );

    if (!response.ok()) {
      const body = await response.text();
      throw new Error(`Failed to create shipment: ${response.status()} - ${body}`);
    }

    return ((await response.json()) as { shipment_id: string }).shipment_id;
  }

  /**
   * Delete a shipment via API.
   */
  async deleteShipment(shipmentId: string): Promise<void> {
    const response = await this.request.delete(
      `${this.baseUrl}/api/organizations/${this.orgId}/collections/shipments/${shipmentId}`,
      { headers: await this.mutatingHeaders() }
    );

    if (!response.ok() && response.status() !== 404) {
      const body = await response.text();
      throw new Error(`Failed to delete shipment: ${response.status()} - ${body}`);
    }
  }
}
