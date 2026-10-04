class LibraryManagerApi {
  static buildMappingUrl(category, { page, pageSize, filters }) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      status: filters.status,
      method: filters.method
    });

    if (filters.search?.trim()) {
      params.set('search', filters.search);
    }

    return `/api/mappings/${encodeURIComponent(category)}?${params.toString()}`;
  }

  static buildChangelogUrl({ page, pageSize, filters }) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize)
    });

    if (filters.table !== 'ANY') {
      params.set('table', filters.table);
    }
    if (filters.operation !== 'ANY') {
      params.set('operation', filters.operation);
    }

    return `/api/changelog?${params.toString()}`;
  }

  static buildGroupUrl({ page, pageSize, filters }) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      includeConfirmed: filters.includeConfirmed ? 'true' : 'false'
    });

    if (filters.search?.trim()) {
      params.set('search', filters.search);
    }

    if (filters.rules?.length) {
      params.set('rules', JSON.stringify(filters.rules));
    }
    if (filters.sort?.length) {
      params.set('sort', JSON.stringify(filters.sort));
    }

    return `/api/groups?${params.toString()}`;
  }

  static buildTableUrl(key, { page, pageSize, filters }) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize)
    });

    if (filters.search?.trim()) {
      params.set('search', filters.search);
    }
    if (key === 'entry') {
      if (filters.sourceType && filters.sourceType !== 'ANY') {
        params.set('sourceType', filters.sourceType);
      }
      if (filters.mappingStatus && filters.mappingStatus !== 'ANY') {
        params.set('mappingStatus', filters.mappingStatus);
      }
    }

    return `/api/tables/${encodeURIComponent(key)}?${params.toString()}`;
  }

  static async fetchJson(url, options = {}) {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.message || `HTTP ${response.status}`);
    }

    return payload;
  }
}
