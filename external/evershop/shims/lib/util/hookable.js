// Payment Truth shim: evershop's plugin hooks with no plugins registered.
export const hookable = (fn, ctx) => (...args) => fn.call(ctx, ...args);
export const hookBefore = () => {};
export const hookAfter = () => {};
