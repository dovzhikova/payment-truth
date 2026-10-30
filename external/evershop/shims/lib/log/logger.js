// Payment Truth shim: evershop logger, collected instead of printed.
export const logs = [];
export const debug = (m) => logs.push(['debug', String(m)]);
export const warning = (m) => logs.push(['warning', String(m)]);
export const info = (m) => logs.push(['info', String(m)]);
export const error = (e) => logs.push(['error', e?.message ?? String(e)]);
