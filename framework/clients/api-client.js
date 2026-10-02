// Client for the sync/ingest API. Returns status and body; does not throw on non-2xx.
export class ApiClient {
  constructor(request, baseUrl) {
    this.request = request;
    this.baseUrl = baseUrl;
  }

  async #send(method, path, options = {}) {
    const response = await this.request.fetch(`${this.baseUrl}${path}`, { method, ...options });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { __unparseable: text };
    }
    return {
      status: response.status(),
      headers: response.headers(),
      body,
    };
  }

  health() {
    return this.#send('GET', '/health');
  }

  listOrders(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.#send('GET', `/orders${query ? `?${query}` : ''}`);
  }

  getOrder(orderId) {
    return this.#send('GET', `/orders/${encodeURIComponent(orderId)}`);
  }

  getCaseEvents(caseId) {
    return this.#send('GET', `/cases/${encodeURIComponent(caseId)}/events`);
  }

  ingest(events) {
    return this.#send('POST', '/sync/events', {
      headers: { 'content-type': 'application/json' },
      data: { events },
    });
  }

  ingestRaw(rawBody) {
    return this.#send('POST', '/sync/events', {
      headers: { 'content-type': 'application/json' },
      data: rawBody,
    });
  }

  // Sends raw bytes via `body`; `data` would JSON-encode them.
  ingestMalformed(rawText) {
    return this.#send('POST', '/sync/events', {
      headers: { 'content-type': 'application/json' },
      body: rawText,
    });
  }
}
