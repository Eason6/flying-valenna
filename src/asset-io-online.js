(function () {
  'use strict';
  window.ValennaAssetIO = {
    async readArrayBuffer(src, { timeoutMs = 10000 } = {}) {
      const url = new URL(src, document.baseURI);
      if (!/^https?:$/.test(url.protocol) || url.origin !== location.origin) throw new Error('Effect must be same-origin HTTP(S)');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url.href, { signal: controller.signal, mode: 'same-origin', redirect: 'error' });
        if (!response.ok) throw new Error('Effect HTTP ' + response.status);
        return await response.arrayBuffer();
      } catch (error) {
        if (controller.signal.aborted) throw new Error('Effect timeout');
        throw error;
      } finally { clearTimeout(timer); }
    }
  };
})();
