(function () {
  'use strict';
  window.ValennaAssetIO = {
    async readArrayBuffer(src) {
      if (!/^data:audio\/wav;base64,/.test(src)) throw new Error('Invalid embedded effect');
      return Uint8Array.from(atob(src.split(',')[1]), char => char.charCodeAt(0)).buffer;
    }
  };
})();
