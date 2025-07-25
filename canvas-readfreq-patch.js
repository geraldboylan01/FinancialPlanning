// Patch canvas.getContext to use willReadFrequently for 2D contexts
const origGetContext = HTMLCanvasElement.prototype.getContext;

if (!origGetContext.__willReadFreqPatch) {
  HTMLCanvasElement.prototype.getContext = function(type, options) {
    if (type === '2d') {
      try {
        const opts = Object.assign({}, options, { willReadFrequently: true });
        return origGetContext.call(this, type, opts);
      } catch (e) {
        return origGetContext.call(this, type, options);
      }
    }
    return origGetContext.call(this, type, options);
  };
  HTMLCanvasElement.prototype.getContext.__willReadFreqPatch = true;
}

export {};
