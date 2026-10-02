/**
 * Thin client over the sync/ingest API.
 *
 * It returns status and body together and never throws on a non-2xx, because in an integration
 * suite the error responses are the subject of the test, not an exception to be handled. A client
 * that throws on 422 forces every negative test into a try/catch and makes the assertion about the
 * throw rather than about the contract.
 */
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

  /**
   * Sends the bytes verbatim via `body` rather than `data`. Playwright's `data` option serialises
   * an object or string to JSON, so passing the string '{ not json' would arrive as the perfectly
   * valid JSON document "{ not json" and the malformed-payload test would silently assert nothing.
   */
  ingestMalformed(rawText) {
    return this.#send('POST', '/sync/events', {
      headers: { 'content-type': 'application/json' },
      body: rawText,
    });
  }
}
